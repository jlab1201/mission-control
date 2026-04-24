/**
 * watcherCore.ts — registry-free, Next.js-free shared helpers.
 *
 * Used by the MC watcher (mainSessionWatcher, subagentWatcher) and by the
 * standalone reporter script (scripts/mc-reporter.ts) which runs via tsx and
 * cannot resolve @/… tsconfig aliases at runtime.
 *
 * Hard constraints:
 *  - Relative imports only (no @/… aliases anywhere in this file)
 *  - No imports from registry, eventBus, snapshotStore, or Next.js modules
 *  - Zero boot-time side effects (no fs reads at module load, no watchers)
 */

import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// encodeProjectPath
// ---------------------------------------------------------------------------

/**
 * Encode a POSIX path to Claude Code's project directory name format.
 * Claude Code replaces `/`, `_`, and `.` all with `-`. Leading `/` becomes a
 * leading `-`.
 * Example: `/home/user/AI_Project/MyProject` → `-home-user-AI-Project-MyProject`
 */
export function encodeProjectPath(path: string): string {
  return path.replace(/[/_.]/g, '-');
}

// ---------------------------------------------------------------------------
// resolveWatchedProjectPath
// ---------------------------------------------------------------------------

/**
 * Resolves the project path to watch. Resolution order (first wins):
 * 1. `~/.mission-control/config.json` → `watchPath` field
 * 2. `WATCH_PROJECT_PATH` environment variable
 * 3. `process.cwd()`
 *
 * Reading the config file on each call keeps the watcher reactive to path
 * changes written by the /api/workspace/watch endpoint without needing a
 * separate invalidation mechanism.
 */
export function resolveWatchedProjectPath(): string {
  // 1. Config file
  const configPath = join(homedir(), '.mission-control', 'config.json');
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { watchPath?: string | null };
      if (parsed.watchPath && typeof parsed.watchPath === 'string') {
        return parsed.watchPath;
      }
    } catch {
      // Fall through on parse errors
    }
  }

  // 2. Environment variable
  if (process.env.WATCH_PROJECT_PATH) {
    return process.env.WATCH_PROJECT_PATH;
  }

  // 3. cwd — but don't watch Mission Control's own install dir.
  const fallback = process.cwd();
  if (looksLikeMissionControlRoot(fallback)) {
    if (!selfWatchWarned) {
      selfWatchWarned = true;
      console.warn(
        `[MC] WATCH_PROJECT_PATH is not set and cwd (${fallback}) is the ` +
          `Mission Control install itself. Falling back to ${homedir()}. ` +
          `Set WATCH_PROJECT_PATH in .env to watch a specific project.`,
      );
    }
    return homedir();
  }
  return fallback;
}

let selfWatchWarned = false;

function looksLikeMissionControlRoot(path: string): boolean {
  try {
    const pkgPath = join(path, 'package.json');
    if (!existsSync(pkgPath) || !existsSync(join(path, 'team-kit'))) return false;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
    return pkg.name === 'mission-control';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Host identity helpers
// ---------------------------------------------------------------------------

/** Returns the host identifier for this MC instance. Defaults to 'local'. */
export function localHostId(): string {
  return process.env.MC_HOST_ID ?? 'local';
}

/** Returns the human-readable host label, or undefined if not set. */
export function localHostLabel(): string | undefined {
  return process.env.MC_HOST_LABEL || undefined;
}

// ---------------------------------------------------------------------------
// Re-exports from incrementalReader
// ---------------------------------------------------------------------------

export { IncrementalReader } from './incrementalReader';

// ---------------------------------------------------------------------------
// Re-exports from jsonlParser
// ---------------------------------------------------------------------------

export {
  parseJsonlLines,
  extractToolUses,
  extractToolResults,
} from './jsonlParser';

export type { RawEntry, ToolUseBlock } from './jsonlParser';
