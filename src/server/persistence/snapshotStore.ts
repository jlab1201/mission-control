/**
 * Lightweight snapshot persistence for Mission Control registry state.
 * Writes to ~/.mission-control/state/<project-slug>.json using a
 * tmp-file + rename pattern for atomicity.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { RegistrySnapshot } from '@/types';
import { SNAPSHOT_SAVE_DEBOUNCE_MS } from '@/lib/config/runtime';
import { expandTilde } from '@/server/workspace/pathGuard';

// ── Path helpers ──────────────────────────────────────────────────────────────

function stateDir(): string {
  // MC_STATE_DIR overrides the default ~/.mission-control/state
  return expandTilde(
    process.env.MC_STATE_DIR ?? path.join(os.homedir(), '.mission-control', 'state'),
  );
}

/**
 * Derive a human-readable slug from an absolute project path.
 * e.g. /home/user/My Project → my-project
 */
export function projectSlug(projectPath: string): string {
  return path.basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function snapshotPath(projectPath: string): string {
  return path.join(stateDir(), `${projectSlug(projectPath)}.json`);
}

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Reads the snapshot for the given project. Returns null if the file is
 * missing or malformed — never throws — so boot always succeeds.
 */
export async function loadSnapshot(projectPath: string): Promise<RegistrySnapshot | null> {
  const filePath = snapshotPath(projectPath);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as RegistrySnapshot;

    // Minimal version guard — reject unknown future versions gracefully
    if (parsed.version !== 1 && parsed.version !== 2) {
      console.warn(`[mission-control] Snapshot version ${String(parsed.version)} not supported; starting fresh.`);
      return null;
    }

    return parsed;
  } catch (err: unknown) {
    const isNotFound = typeof err === 'object' && err !== null && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (!isNotFound) {
      console.warn('[mission-control] Could not load snapshot, starting fresh:', err);
    }
    return null;
  }
}

// ── Debounced save ────────────────────────────────────────────────────────────

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedules an atomic write of the snapshot, debounced by 1 s per project.
 * Multiple mutations within the same second coalesce into one write.
 * Uses tmp-file + fs.rename for atomicity — no partial reads.
 */
export function scheduleSave(projectPath: string, snapshot: RegistrySnapshot): void {
  if (!projectPath) return;
  const existing = pendingTimers.get(projectPath);
  if (existing !== undefined) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    pendingTimers.delete(projectPath);
    writeSnapshot(projectPath, snapshot).catch((err) => {
      console.error('[mission-control] Failed to persist snapshot:', err);
    });
  }, SNAPSHOT_SAVE_DEBOUNCE_MS);

  pendingTimers.set(projectPath, timer);
}

async function writeSnapshot(projectPath: string, snapshot: RegistrySnapshot): Promise<void> {
  const dir = stateDir();
  await fs.mkdir(dir, { recursive: true });

  const dest = snapshotPath(projectPath);
  const tmp = `${dest}.tmp`;
  const json = JSON.stringify(snapshot, null, 2);

  await fs.writeFile(tmp, json, 'utf-8');
  await fs.rename(tmp, dest);
}
