import { homedir } from 'os';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import {
  encodeProjectPath,
  resolveWatchedProjectPath,
} from './watcherCore';

export interface SessionLocation {
  sessionId: string;
  jsonlPath: string;
  subagentsDir: string;
  projectDir: string;
}

/**
 * Alias for resolveWatchedProjectPath() — kept for backward compatibility with
 * callers that import getWatchedProjectPath from this module.
 */
export function getWatchedProjectPath(): string {
  return resolveWatchedProjectPath();
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
