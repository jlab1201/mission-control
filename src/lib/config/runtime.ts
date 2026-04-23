// All values can be overridden at runtime via the corresponding environment variable.

const numEnv = (name: string, fallback: number): number => {
  const v = process.env[name];
  const n = v !== undefined ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

// ---------------------------------------------------------------------------
// Server-side tunables (Node.js only — do NOT import in client components)
// ---------------------------------------------------------------------------

/** How often the watcher polls for file changes (ms). Env: MC_POLL_INTERVAL_MS */
export const POLL_INTERVAL_MS = numEnv('MC_POLL_INTERVAL_MS', 750);

/** File-change recency window that marks an agent as "active" (ms). Env: MC_AGENT_ACTIVE_THRESHOLD_MS */
export const AGENT_ACTIVE_THRESHOLD_MS = numEnv('MC_AGENT_ACTIVE_THRESHOLD_MS', 30_000);

/** Inactivity window before an agent is considered "completed" (ms). Env: MC_AGENT_COMPLETED_THRESHOLD_MS */
export const AGENT_COMPLETED_THRESHOLD_MS = numEnv('MC_AGENT_COMPLETED_THRESHOLD_MS', 60_000);

/** Debounce delay before writing a snapshot to disk (ms). Env: MC_SNAPSHOT_SAVE_DEBOUNCE_MS */
export const SNAPSHOT_SAVE_DEBOUNCE_MS = numEnv('MC_SNAPSHOT_SAVE_DEBOUNCE_MS', 1_000);

/** Maximum concurrent SSE connections. Env: MC_MAX_SSE_CONNECTIONS */
export const MAX_SSE_CONNECTIONS = numEnv('MC_MAX_SSE_CONNECTIONS', 10);

/** Interval between SSE keepalive pings (ms). Env: MC_SSE_HEARTBEAT_MS */
export const SSE_HEARTBEAT_MS = numEnv('MC_SSE_HEARTBEAT_MS', 15_000);

/** Maximum events replayed to a reconnecting SSE client. Env: MC_MAX_REPLAY_EVENTS */
export const MAX_REPLAY_EVENTS = numEnv('MC_MAX_REPLAY_EVENTS', 500);

/** Size of the in-memory event ring buffer. Env: MC_EVENT_RING_BUFFER_SIZE */
export const EVENT_RING_BUFFER_SIZE = numEnv('MC_EVENT_RING_BUFFER_SIZE', 500);

/** Maximum events persisted in a snapshot. Env: MC_SNAPSHOT_EVENT_LIMIT */
export const SNAPSHOT_EVENT_LIMIT = numEnv('MC_SNAPSHOT_EVENT_LIMIT', 200);

/** Bytes to read back from a JSONL file on cold-start. Env: MC_JSONL_LOOKBACK_BYTES */
export const JSONL_LOOKBACK_BYTES = numEnv('MC_JSONL_LOOKBACK_BYTES', 768 * 1024);

/** Maximum recent tool names tracked per agent. Env: MC_MAX_RECENT_TOOLS */
export const MAX_RECENT_TOOLS = numEnv('MC_MAX_RECENT_TOOLS', 20);

/** Rolling window for counting recent tool-use timestamps (ms). Env: MC_RECENT_TOOLUSE_WINDOW_MS */
export const RECENT_TOOLUSE_WINDOW_MS = numEnv('MC_RECENT_TOOLUSE_WINDOW_MS', 60_000);

/** Maximum characters of a prompt included in the preview field. Env: MC_PROMPT_PREVIEW_CHARS */
export const PROMPT_PREVIEW_CHARS = numEnv('MC_PROMPT_PREVIEW_CHARS', 500);

/** Maximum events returned by the /api/events endpoint per request. Env: MC_MAX_EVENTS_PER_REQUEST */
export const MAX_EVENTS_PER_REQUEST = numEnv('MC_MAX_EVENTS_PER_REQUEST', 500);

/** Default event count when no limit query param is provided. Env: MC_DEFAULT_EVENTS_LIMIT */
export const DEFAULT_EVENTS_LIMIT = numEnv('MC_DEFAULT_EVENTS_LIMIT', 200);

/** Maximum /api/ingest body size in bytes. Env: MC_MAX_INGEST_BODY_BYTES */
export const MAX_INGEST_BODY_BYTES = numEnv('MC_MAX_INGEST_BODY_BYTES', 5_242_880);

/** Per-token ingest rate burst. Env: MC_INGEST_RATE_BURST */
export const INGEST_RATE_BURST = numEnv('MC_INGEST_RATE_BURST', 100);

/** Per-token ingest refill per second. Env: MC_INGEST_RATE_REFILL_PER_SEC */
export const INGEST_RATE_REFILL_PER_SEC = numEnv('MC_INGEST_RATE_REFILL_PER_SEC', 10);

// ---------------------------------------------------------------------------
// Client-side tunables (inlined into the browser bundle via NEXT_PUBLIC_ prefix)
// ---------------------------------------------------------------------------

/** Maximum events held in the client-side mission store. Env: NEXT_PUBLIC_MC_CLIENT_EVENT_LIMIT */
export const CLIENT_EVENT_LIMIT =
  typeof process !== 'undefined' &&
  typeof process.env['NEXT_PUBLIC_MC_CLIENT_EVENT_LIMIT'] !== 'undefined'
    ? Number(process.env['NEXT_PUBLIC_MC_CLIENT_EVENT_LIMIT']) || 200
    : 200;
