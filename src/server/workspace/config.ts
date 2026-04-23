import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import type { WorkspaceConfig } from '@/types/workspace';

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
};

/**
 * Reads the persisted WorkspaceConfig from CONFIG_PATH.
 * Returns a default config when the file does not exist yet — first-run safe.
 */
export async function readConfig(): Promise<WorkspaceConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WorkspaceConfig>;
    return {
      watchPath: parsed.watchPath ?? null,
      recentPaths: Array.isArray(parsed.recentPaths)
        ? parsed.recentPaths.slice(0, MAX_RECENT_PATHS)
        : [],
    };
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
