import { homedir } from 'os';
import { cwd } from 'process';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, basename } from 'path';

export interface SessionLocation {
  sessionId: string;
  jsonlPath: string;
  subagentsDir: string;
  projectDir: string;
}

/**
 * Encode a POSIX path to Claude Code's project directory name format.
 * Claude Code replaces `/`, `_`, and `.` all with `-`. Leading `/` becomes a leading `-`.
 * Example: `/home/user/AI_Project/MyProject` → `-home-user-AI-Project-MyProject`
 */
function encodeProjectPath(path: string): string {
  return path.replace(/[/_.]/g, '-');
}

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
export function getWatchedProjectPath(): string {
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

  // 3. cwd()
  return cwd();
}

export function findCurrentSession(): SessionLocation | null {
  const projectDir =
    homedir() + '/.claude/projects/' + encodeProjectPath(getWatchedProjectPath());

  if (!existsSync(projectDir)) {
    return null;
  }

  let entries: string[];
  try {
    entries = readdirSync(projectDir);
  } catch {
    return null;
  }

  const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'));
  if (jsonlFiles.length === 0) {
    return null;
  }

  // Pick the most-recently modified .jsonl file
  let latestFile: string | null = null;
  let latestMtime = 0;

  for (const file of jsonlFiles) {
    try {
      const stat = statSync(join(projectDir, file));
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestFile = file;
      }
    } catch {
      // ignore unreadable files
    }
  }

  if (!latestFile) {
    return null;
  }

  const sessionId = basename(latestFile, '.jsonl');
  const jsonlPath = join(projectDir, latestFile);
  const subagentsDir = join(projectDir, sessionId, 'subagents');

  return { sessionId, jsonlPath, subagentsDir, projectDir };
}
