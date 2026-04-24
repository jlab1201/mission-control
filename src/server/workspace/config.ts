import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import type { WorkspaceConfig, RegisteredProject } from '@/types/workspace';

const MAX_RECENT_PATHS = 5;

/**
 * Absolute path to the persisted config file.
 * Exposed so tests can override via process.env.MC_CONFIG_PATH if needed.
 */
export const CONFIG_PATH =
  process.env.MC_CONFIG_PATH ?? path.join(os.homedir(), '.mission-control', 'config.json');

const DEFAULT_CONFIG: WorkspaceConfig = {
  watchPath: null,
  recentPaths: [],
  registeredProjects: [],
};

// ---------------------------------------------------------------------------
// In-module async mutex (I1 — read-modify-write race)
// Serialises all public functions that do readConfig → mutate → writeConfig.
// Pure reads (listRegisteredProjects) are NOT wrapped because they are
// idempotent and adding them to the chain would unnecessarily slow queries.
// ---------------------------------------------------------------------------

let writeChain: Promise<void> = Promise.resolve();

function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeChain;
  let release!: () => void;
  writeChain = new Promise<void>((r) => {
    release = r;
  });
  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

// ---------------------------------------------------------------------------
// Core read / write
// ---------------------------------------------------------------------------

/**
 * Reads the persisted WorkspaceConfig from CONFIG_PATH.
 * Returns a default config when the file does not exist yet — first-run safe.
 * If `registeredProjects` is missing from the persisted JSON, initialises it
 * to [] and immediately persists the updated config.
 *
 * I6 — Corrupt-file handling:
 *   When the file exists but is not valid JSON, the corrupt file is renamed to
 *   `<CONFIG_PATH>.bak-<ISO-timestamp>` before returning defaults.  A console
 *   warning is emitted with both paths.  An ENOENT (file-not-found) continues
 *   to return defaults silently — that is the expected first-run path.
 */
export async function readConfig(): Promise<WorkspaceConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WorkspaceConfig>;
    const needsMigration = !Array.isArray(parsed.registeredProjects);
    const cfg: WorkspaceConfig = {
      watchPath: parsed.watchPath ?? null,
      recentPaths: Array.isArray(parsed.recentPaths)
        ? parsed.recentPaths.slice(0, MAX_RECENT_PATHS)
        : [],
      registeredProjects: Array.isArray(parsed.registeredProjects)
        ? (parsed.registeredProjects as RegisteredProject[])
        : [],
    };
    if (needsMigration) {
      await writeConfig(cfg);
    }
    return cfg;
  } catch (err: unknown) {
    // Distinguish "file not found" (first-run, already handled above, but
    // guard here defensively) from a genuine parse/read error.
    const isNotFound =
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT';

    if (isNotFound) {
      return { ...DEFAULT_CONFIG };
    }

    // Corrupted file — back it up before returning defaults so the user's
    // registered projects are not silently overwritten on the next write.
    const backupPath = `${CONFIG_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      await fs.rename(CONFIG_PATH, backupPath);
      console.warn(
        `[mission-control] config.json was corrupt and has been renamed to ${backupPath}. ` +
          `Returning default config. Original error:`,
        err,
      );
    } catch (renameErr: unknown) {
      console.warn(
        `[mission-control] config.json appears corrupt but could not be backed up to ${backupPath}. ` +
          `Returning default config. Parse error:`,
        err,
        `Rename error:`,
        renameErr,
      );
    }

    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Atomically writes `cfg` to CONFIG_PATH via a .tmp file rename.
 * Creates the parent directory on first write. Enforces the 5-path cap.
 */
export async function writeConfig(cfg: WorkspaceConfig): Promise<void> {
  const configDir = path.dirname(CONFIG_PATH);
  await fs.mkdir(configDir, { recursive: true });

  const safe: WorkspaceConfig = {
    watchPath: cfg.watchPath,
    recentPaths: cfg.recentPaths.slice(0, MAX_RECENT_PATHS),
    registeredProjects: cfg.registeredProjects,
  };

  const tmpPath = CONFIG_PATH + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(safe, null, 2), 'utf-8');
  await fs.rename(tmpPath, CONFIG_PATH);
}

// ---------------------------------------------------------------------------
// Pure helpers (no write — no lock needed)
// ---------------------------------------------------------------------------

/**
 * Prepends `newPath` to `recentPaths`, deduplicates, and caps at MAX_RECENT_PATHS.
 * Mutates nothing — returns a new array.
 */
export function prependRecentPath(existing: string[], newPath: string): string[] {
  const deduped = [newPath, ...existing.filter((p) => p !== newPath)];
  return deduped.slice(0, MAX_RECENT_PATHS);
}

// ---------------------------------------------------------------------------
// Registered Project helpers
// ---------------------------------------------------------------------------

/** Returns all registered projects from the persisted config. */
export async function listRegisteredProjects(): Promise<RegisteredProject[]> {
  const cfg = await readConfig();
  return cfg.registeredProjects;
}

/**
 * Adds (or idempotently updates) a registered project.
 * Idempotent on `(hostId, path)`: if an entry with the same host+path already
 * exists the `name` is updated in-place and the existing entry is returned.
 * Otherwise a new entry is created with a fresh UUID.
 *
 * Wrapped with withConfigLock to prevent read-modify-write races (I1).
 */
export async function addRegisteredProject(input: {
  name: string;
  hostId: string;
  path: string;
}): Promise<RegisteredProject> {
  return withConfigLock(async () => {
    const cfg = await readConfig();
    const existing = cfg.registeredProjects.find(
      (p) => p.hostId === input.hostId && p.path === input.path,
    );

    if (existing) {
      existing.name = input.name;
      await writeConfig(cfg);
      return existing;
    }

    const entry: RegisteredProject = {
      id: randomUUID(),
      name: input.name,
      path: input.path,
      hostId: input.hostId,
      registeredAt: new Date().toISOString(),
    };
    cfg.registeredProjects.push(entry);
    await writeConfig(cfg);
    return entry;
  });
}

/**
 * Removes a registered project by id.
 * Returns true when the entry was found and removed; false when not found.
 *
 * Wrapped with withConfigLock to prevent read-modify-write races (I1).
 */
export async function removeRegisteredProject(id: string): Promise<boolean> {
  return withConfigLock(async () => {
    const cfg = await readConfig();
    const before = cfg.registeredProjects.length;
    cfg.registeredProjects = cfg.registeredProjects.filter((p) => p.id !== id);
    if (cfg.registeredProjects.length === before) return false;
    await writeConfig(cfg);
    return true;
  });
}
