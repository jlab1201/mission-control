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

/**
 * Reads the persisted WorkspaceConfig from CONFIG_PATH.
 * Returns a default config when the file does not exist yet — first-run safe.
 * If `registeredProjects` is missing from the persisted JSON, initialises it to []
 * and immediately persists the updated config.
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
  } catch {
    // Corrupted file — return defaults rather than hard-crashing
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
 */
export async function addRegisteredProject(input: {
  name: string;
  hostId: string;
  path: string;
}): Promise<RegisteredProject> {
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
}

/**
 * Removes a registered project by id.
 * Returns true when the entry was found and removed; false when not found.
 */
export async function removeRegisteredProject(id: string): Promise<boolean> {
  const cfg = await readConfig();
  const before = cfg.registeredProjects.length;
  cfg.registeredProjects = cfg.registeredProjects.filter((p) => p.id !== id);
  if (cfg.registeredProjects.length === before) return false;
  await writeConfig(cfg);
  return true;
}
