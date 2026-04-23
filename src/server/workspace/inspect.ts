import { access, constants } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { assertPathInHome } from './pathGuard';
import type { InspectResponse, WorkspaceState } from '@/types/workspace';

/**
 * Inspects an absolute filesystem path and returns its workspace state along
 * with UI hints for what action the dashboard should offer the user.
 */
export async function inspectPath(rawPath: string): Promise<InspectResponse> {
  // 0. Guard: reject paths that escape the user's home directory.
  const targetPath = assertPathInHome(rawPath);

  // 1. Does the path exist?
  if (!existsSync(targetPath)) {
    return {
      path: targetPath,
      state: 'missing',
      canInstall: true,
      canForceReinstall: false,
      recommendedAction: 'create-and-install',
    };
  }

  // 2. Is it writable?
  try {
    await access(targetPath, constants.W_OK);
  } catch {
    return {
      path: targetPath,
      state: 'not-writable',
      canInstall: false,
      canForceReinstall: false,
      recommendedAction: 'block',
    };
  }

  // 3. Determine .claude/ state
  const claudeDir = path.join(targetPath, '.claude');
  const teamLeadMarker = path.join(targetPath, '.claude', 'agents', 'team-lead.md');

  let state: WorkspaceState;
  if (!existsSync(claudeDir)) {
    state = 'empty';
  } else if (existsSync(teamLeadMarker)) {
    state = 'teamkit-installed';
  } else {
    state = 'custom-claude';
  }

  type StateFlags = Pick<InspectResponse, 'canInstall' | 'canForceReinstall' | 'recommendedAction'>;
  const stateMap: Record<WorkspaceState, StateFlags> = {
    empty: { canInstall: true, canForceReinstall: false, recommendedAction: 'install' },
    'teamkit-installed': { canInstall: false, canForceReinstall: true, recommendedAction: 'watch' },
    'custom-claude': { canInstall: false, canForceReinstall: true, recommendedAction: 'watch' },
    // Handled above; included for exhaustiveness
    missing: { canInstall: true, canForceReinstall: false, recommendedAction: 'create-and-install' },
    'not-writable': { canInstall: false, canForceReinstall: false, recommendedAction: 'block' },
  };

  return {
    path: targetPath,
    state,
    ...stateMap[state],
  };
}
