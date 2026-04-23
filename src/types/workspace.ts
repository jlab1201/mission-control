/**
 * Workspace Manager — shared types for backend services and the frontend settings UI.
 * These types are the Phase 1 contract; Phase 2 will implement the server logic against them.
 */

// ---------------------------------------------------------------------------
// Detection state
// ---------------------------------------------------------------------------

/**
 * The five possible states of a project path as detected by the inspect endpoint.
 *
 * - `'missing'`           Path does not exist on disk.
 * - `'empty'`             Path exists and is writable, but contains no `.claude/` directory.
 * - `'teamkit-installed'` Path has `.claude/agents/team-lead.md` — recognised as our kit.
 * - `'custom-claude'`     Path has `.claude/` but it does not match our kit signature.
 * - `'not-writable'`      Path exists but the process lacks write permission.
 */
export type WorkspaceState =
  | 'missing'
  | 'empty'
  | 'teamkit-installed'
  | 'custom-claude'
  | 'not-writable';

// ---------------------------------------------------------------------------
// API response / request shapes
// ---------------------------------------------------------------------------

/**
 * Returned by `GET /api/workspace/inspect?path=<abs>`.
 *
 * `canInstall`         — true when a fresh install can proceed without flags.
 * `canForceReinstall`  — true when an existing `.claude/` could be overwritten.
 * `recommendedAction`  — UI hint for the primary CTA button:
 *   - `'install'`            — path is empty, safe to copy team-kit in.
 *   - `'watch'`              — team-kit already present, just start watching.
 *   - `'create-and-install'` — path is missing, MC should mkdir then install.
 *   - `'block'`              — not writable or custom `.claude/`; user must resolve manually.
 */
export interface InspectResponse {
  path: string;
  state: WorkspaceState;
  canInstall: boolean;
  canForceReinstall: boolean;
  recommendedAction: 'install' | 'watch' | 'create-and-install' | 'block';
}

/**
 * Body for `POST /api/workspace/install`.
 *
 * `path`              — Absolute path to the target project directory.
 * `force`             — If true, overwrite an existing `.claude/` directory.
 * `createIfMissing`   — If true, create the directory when it does not exist before installing.
 */
export interface InstallRequest {
  path: string;
  force?: boolean;
  createIfMissing?: boolean;
}

/**
 * Returned by `POST /api/workspace/install`.
 *
 * `status`  — `'installed'` on success, `'skipped'` when team-kit was already present
 *             and `force` was not set, `'error'` on any failure.
 * `message` — Human-readable detail (safe to surface directly in the UI).
 */
export interface InstallResponse {
  status: 'installed' | 'skipped' | 'error';
  message: string;
}

/**
 * Persisted configuration stored at `~/.mission-control/config.json`.
 *
 * `watchPath`    — The absolute path currently being watched by the JSONL watcher.
 *                  `null` when no watch is active.
 * `recentPaths`  — Last N paths used (capped at 5, most-recent first).
 */
export interface WorkspaceConfig {
  watchPath: string | null;
  recentPaths: string[]; // max length 5
}

/**
 * Body for `POST /api/workspace/watch`.
 *
 * Instructs the server to switch the active watch path to `path`.
 * Returns the updated `WorkspaceConfig` so the UI can reflect the change immediately.
 */
export interface WatchRequest {
  path: string;
}
