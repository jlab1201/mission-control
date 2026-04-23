import fs from 'fs/promises';
import path from 'path';
import { inspectPath } from './inspect';
import { assertPathInHome } from './pathGuard';
import type { InstallRequest, InstallResponse } from '@/types/workspace';

/**
 * Absolute path to the team-kit master directory.
 * Override with MC_TEAM_KIT_SOURCE env var for non-standard layouts.
 * Defaults to <project-root>/team-kit resolved from process.cwd(), which is
 * the MC project root when running `pnpm dev` or `pnpm start` via Next.js.
 * process.cwd() is reliable here because Next.js always sets cwd to the
 * project root before starting the dev/prod server.
 */
export const TEAM_KIT_SOURCE =
  process.env.MC_TEAM_KIT_SOURCE ?? path.join(process.cwd(), 'team-kit');

/**
 * Copies the team-kit from TEAM_KIT_SOURCE into the path specified in the request.
 * Runs a pre-flight inspect to avoid trusting stale client state.
 */
export async function installTeamKit(req: InstallRequest): Promise<InstallResponse> {
  const { path: rawPath, force = false, createIfMissing = false } = req;

  // Guard: reject paths that escape the user's home directory.
  let targetPath: string;
  try {
    targetPath = assertPathInHome(rawPath);
  } catch {
    return { status: 'error', message: 'PATH_UNSAFE: path must be inside the home directory' };
  }

  // Pre-flight: always re-inspect the path server-side
  const inspection = await inspectPath(targetPath);

  if (inspection.state === 'not-writable') {
    return { status: 'error', message: 'Path is not writable' };
  }

  if (inspection.state === 'missing') {
    if (!createIfMissing) {
      return { status: 'error', message: 'Path does not exist — set createIfMissing: true to create it' };
    }
    try {
      await fs.mkdir(targetPath, { recursive: true });
    } catch (err) {
      return { status: 'error', message: `Failed to create directory: ${(err as Error).message}` };
    }
  }

  // If .claude/ already exists and force not set, skip
  const hasClaude = inspection.state === 'teamkit-installed' || inspection.state === 'custom-claude';
  if (hasClaude && !force) {
    return {
      status: 'skipped',
      message: 'Already has .claude/ — use force: true to overwrite',
    };
  }

  // Force: remove only .claude/ and CLAUDE.md — do NOT wipe the whole directory
  if (hasClaude && force) {
    const claudeDir = path.join(targetPath, '.claude');
    const claudeMd = path.join(targetPath, 'CLAUDE.md');
    await Promise.all([
      fs.rm(claudeDir, { recursive: true, force: true }),
      fs.rm(claudeMd, { force: true }),
    ]);
  }

  // Copy contents of TEAM_KIT_SOURCE into targetPath (not a nested folder)
  // fs.cp with source/* semantics: enumerate top-level entries and copy each
  try {
    const entries = await fs.readdir(TEAM_KIT_SOURCE);
    await Promise.all(
      entries.map((entry) =>
        fs.cp(path.join(TEAM_KIT_SOURCE, entry), path.join(targetPath, entry), {
          recursive: true,
          errorOnExist: false,
        })
      )
    );
  } catch (err) {
    // Partial-copy cleanup: remove .claude/ if it was created
    await fs.rm(path.join(targetPath, '.claude'), { recursive: true, force: true });
    return { status: 'error', message: `Install failed: ${(err as Error).message}` };
  }

  return { status: 'installed', message: 'team-kit installed successfully' };
}
