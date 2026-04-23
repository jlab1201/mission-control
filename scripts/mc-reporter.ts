#!/usr/bin/env node
/**
 * mc-reporter.ts — standalone Mission Control reporter.
 *
 * Run via: pnpm tsx scripts/mc-reporter.ts
 * Or:      node --import tsx scripts/mc-reporter.ts
 *
 * Tails the local Claude session JSONL files and POSTs live state to a
 * remote MC server at MC_REPORTER_TARGET_URL/api/ingest.
 */

import { readdirSync, statSync } from 'fs';
import { open, stat } from 'fs/promises';
import { homedir } from 'os';
import { join, basename } from 'path';

import {
  encodeProjectPath,
  resolveWatchedProjectPath,
  parseJsonlLines,
} from '../src/server/watcher/watcherCore';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FLAG_ONCE = args.includes('--once');
const FLAG_HELP = args.includes('--help') || args.includes('-h');

if (FLAG_HELP) {
  process.stdout.write(`
mc-reporter — forward local Claude session data to a Mission Control server.

Environment variables:
  MC_REPORTER_TARGET_URL          (required) e.g. https://mc.example.com
  MC_REPORTER_TOKEN               (required) bearer token for /api/ingest
  MC_REPORTER_HOST_ID             (required) stable host identifier, /^[a-zA-Z0-9_-]{1,64}$/
  MC_REPORTER_HOST_LABEL          (optional) human-readable host name
  WATCH_PROJECT_PATH              (optional) project path to watch, defaults to cwd
  MC_REPORTER_BATCH_INTERVAL_MS   (optional) delta interval in ms, default 1000
  MC_REPORTER_SNAPSHOT_INTERVAL_MS(optional) snapshot interval in ms, default 30000
  MC_REPORTER_HTTP_TIMEOUT_MS     (optional) HTTP timeout in ms, default 10000

CLI flags:
  --once    Send one snapshot and exit 0 on success.
  --help, -h  Print this message and exit.

Example:
  MC_REPORTER_TARGET_URL=https://mc.example.com \\
  MC_REPORTER_TOKEN=mytoken \\
  MC_REPORTER_HOST_ID=my-laptop \\
  pnpm tsx scripts/mc-reporter.ts
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

function readEnv(): {
  targetUrl: string;
  token: string;
  hostId: string;
  hostLabel: string | undefined;
  watchProjectPath: string;
  watchedProjectPath: string;
  batchIntervalMs: number;
  snapshotIntervalMs: number;
  httpTimeoutMs: number;
} {
  const missing: string[] = [];

  const targetUrl = process.env.MC_REPORTER_TARGET_URL ?? '';
  const token = process.env.MC_REPORTER_TOKEN ?? '';
  const hostId = process.env.MC_REPORTER_HOST_ID ?? '';

  if (!targetUrl) missing.push('MC_REPORTER_TARGET_URL');
  if (!token) missing.push('MC_REPORTER_TOKEN');
  if (!hostId) missing.push('MC_REPORTER_HOST_ID');

  if (missing.length > 0) {
    process.stderr.write(
      `[mc-reporter] ERROR: missing required env vars: ${missing.join(', ')}\n`,
    );
    process.exit(2);
  }

  const hostIdRe = /^[a-zA-Z0-9_-]{1,64}$/;
  if (!hostIdRe.test(hostId)) {
    process.stderr.write(
      `[mc-reporter] ERROR: MC_REPORTER_HOST_ID must match /^[a-zA-Z0-9_-]{1,64}$/, got: "${hostId}"\n`,
    );
    process.exit(2);
  }

  const hostLabel = process.env.MC_REPORTER_HOST_LABEL || undefined;
  const batchIntervalMs = Number(process.env.MC_REPORTER_BATCH_INTERVAL_MS ?? 1000);
  const snapshotIntervalMs = Number(process.env.MC_REPORTER_SNAPSHOT_INTERVAL_MS ?? 30000);
  const httpTimeoutMs = Number(process.env.MC_REPORTER_HTTP_TIMEOUT_MS ?? 10000);

  return {
    targetUrl,
    token,
    hostId,
    hostLabel,
    watchProjectPath: process.env.WATCH_PROJECT_PATH ?? process.cwd(),
    watchedProjectPath: resolveWatchedProjectPath(),
    batchIntervalMs,
    snapshotIntervalMs,
    httpTimeoutMs,
  };
}

const cfg = readEnv();

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

process.stdout.write(
  `[mc-reporter] targeting ${cfg.targetUrl} as host=${cfg.hostId} watching=${cfg.watchedProjectPath}\n`,
);

try {
  const u = new URL(cfg.targetUrl);
  const loopback = ['localhost', '127.0.0.1', '::1'];
  if (u.protocol === 'http:' && !loopback.includes(u.hostname)) {
    process.stderr.write(
      `[mc-reporter] WARN: target is plain HTTP on a non-loopback address — traffic will be unencrypted\n`,
    );
  }
} catch {
  // Invalid URL — will fail later at POST time
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function log(level: LogLevel, msg: string): void {
  process.stderr.write(`[mc-reporter] ${new Date().toISOString()} ${level} ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Lightweight incremental reader (avoids @/lib/config/runtime import)
// ---------------------------------------------------------------------------

class SimpleIncrementalReader {
  private diskOffset = 0;
  private leftover = '';

  constructor(private readonly path: string) {}

  /** Cold start: read up to last 64 KB of file. Returns complete lines. */
  async coldStart(): Promise<string> {
    try {
      const info = await stat(this.path);
      const lookback = 65536;
      const startByte = Math.max(0, info.size - lookback);
      const length = info.size - startByte;
      if (length <= 0) {
        this.diskOffset = info.size;
        return '';
      }
      const fh = await open(this.path, 'r');
      try {
        const buf = Buffer.allocUnsafe(length);
        const { bytesRead } = await fh.read(buf, 0, length, startByte);
        const text = buf.slice(0, bytesRead).toString('utf8');
        const lastNl = text.lastIndexOf('\n');
        if (lastNl === -1) {
          this.leftover = text;
          this.diskOffset = startByte;
          return '';
        }
        const complete = text.slice(0, lastNl + 1);
        this.leftover = text.slice(lastNl + 1);
        this.diskOffset = startByte + Buffer.byteLength(complete, 'utf8');
        return complete;
      } finally {
        await fh.close();
      }
    } catch {
      return '';
    }
  }

  /** Read newly appended bytes since last read. Returns complete lines. */
  async readNew(): Promise<string> {
    try {
      const info = await stat(this.path);
      if (info.size < this.diskOffset) {
        this.diskOffset = 0;
        this.leftover = '';
      }
      if (info.size === this.diskOffset) return '';
      const startByte = this.diskOffset;
      const length = info.size - startByte;
      const fh = await open(this.path, 'r');
      try {
        const buf = Buffer.allocUnsafe(length);
        const { bytesRead } = await fh.read(buf, 0, length, startByte);
        const text = this.leftover + buf.slice(0, bytesRead).toString('utf8');
        const lastNl = text.lastIndexOf('\n');
        if (lastNl === -1) {
          this.leftover = text;
          this.diskOffset = startByte + bytesRead;
          return '';
        }
        const complete = text.slice(0, lastNl + 1);
        this.leftover = text.slice(lastNl + 1);
        this.diskOffset = startByte + bytesRead;
        return complete;
      } finally {
        await fh.close();
      }
    } catch {
      return '';
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory state types
// ---------------------------------------------------------------------------

interface ReporterAgent {
  agentId: string;
  agentName: string;
  toolUseCount: number;
  firstSeenAt: string;
  lastActiveAt: string;
  transcriptPath: string;
}

interface ReporterEvent {
  agentId: string;
  agentName: string;
  type: string;
  toolName?: string;
  summary: string;
  timestamp: string;
}

interface ReporterTask {
  taskId: string;
  agentId: string;
  status: string;
  content: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const MAX_EVENTS = 2000;

const agents = new Map<string, ReporterAgent>();
const events: ReporterEvent[] = [];
const tasks = new Map<string, ReporterTask>();

// Track what changed since last flush
let changedAgentIds = new Set<string>();
let newEvents: ReporterEvent[] = [];
let hasChanges = false;

// Warn-once throttle for event overflow
let lastEventOverflowWarnTs = 0;

function addEvent(ev: ReporterEvent): void {
  if (events.length >= MAX_EVENTS) {
    events.shift();
    const now = Date.now();
    if (now - lastEventOverflowWarnTs > 60_000) {
      log('WARN', `Event buffer at ${MAX_EVENTS} cap — dropping oldest events`);
      lastEventOverflowWarnTs = now;
    }
  }
  events.push(ev);
  newEvents.push(ev);
  hasChanges = true;
}

function upsertAgent(id: string, name: string, ts: string, transcriptPath: string): void {
  const existing = agents.get(id);
  agents.set(id, {
    agentId: id,
    agentName: name,
    toolUseCount: (existing?.toolUseCount ?? 0) + 1,
    firstSeenAt: existing?.firstSeenAt ?? ts,
    lastActiveAt: ts,
    transcriptPath: existing?.transcriptPath ?? transcriptPath,
  });
  changedAgentIds.add(id);
  hasChanges = true;
}

// ---------------------------------------------------------------------------
// JSONL processing
// ---------------------------------------------------------------------------

/**
 * Extract a coarse agent name from the JSONL file path.
 * Main session → "orchestrator", subagents → basename of dir (the uuid fragment).
 */
function agentNameFromPath(filePath: string): string {
  const parts = filePath.split('/');
  // If inside a subagents/ subdirectory, use the parent dir name
  const subIdx = parts.lastIndexOf('subagents');
  if (subIdx !== -1 && subIdx < parts.length - 1) {
    return parts[subIdx + 1] ?? 'subagent';
  }
  return 'orchestrator';
}

function processLines(rawLines: string, filePath: string): void {
  const { entries } = parseJsonlLines(rawLines);
  const agentName = agentNameFromPath(filePath);
  // Use file path as a stable agent id
  const agentId = encodeProjectPath(filePath).replace(/^-+/, '');

  for (const entry of entries) {
    const ts = entry.timestamp ?? new Date().toISOString();

    // Tool use blocks from assistant messages
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content as Array<{ type: string; name?: string; id?: string }>) {
        if (block.type === 'tool_use') {
          upsertAgent(agentId, agentName, ts, filePath);
          addEvent({
            agentId,
            agentName,
            type: 'tool_use',
            toolName: block.name,
            summary: `tool_use: ${block.name ?? 'unknown'}`,
            timestamp: ts,
          });
        }
      }
    }

    // Task tool results (summary events) — RawToolUseResult's runtime shape has
    // extra fields (toolUseId, content) that aren't in the declared type. Cast.
    if (entry.type === 'tool' && entry.toolUseResult) {
      const result = entry.toolUseResult as { toolUseId?: string; content?: unknown };
      const taskId = result.toolUseId ?? '';
      if (taskId) {
        tasks.set(taskId, {
          taskId,
          agentId,
          status: 'done',
          content: typeof result.content === 'string' ? result.content.slice(0, 200) : '',
        });
        hasChanges = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session file discovery
// ---------------------------------------------------------------------------

interface SessionFiles {
  main: string;
  subagents: string[];
}

function findSessionFiles(watchedPath: string): SessionFiles | null {
  const encoded = encodeProjectPath(watchedPath);
  const projectDir = join(homedir(), '.claude', 'projects', encoded);

  let mainFiles: string[] = [];
  try {
    mainFiles = readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl') && !f.includes('subagents'))
      .map((f) => join(projectDir, f));
  } catch {
    return null;
  }

  if (mainFiles.length === 0) return null;

  // Pick most recently modified
  const main = mainFiles
    .map((f) => {
      try {
        return { f, mtime: statSync(f).mtimeMs };
      } catch {
        return { f, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime)[0]?.f;

  if (!main) return null;

  // Find subagent jsonl files
  const subagentsDir = join(projectDir, 'subagents');
  let subagents: string[] = [];
  try {
    subagents = readdirSync(subagentsDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(subagentsDir, f));
  } catch {
    // subagents dir may not exist — that's fine
  }

  return { main, subagents };
}

// ---------------------------------------------------------------------------
// Readers registry
// ---------------------------------------------------------------------------

const readers = new Map<string, SimpleIncrementalReader>();

async function initReader(filePath: string): Promise<void> {
  if (readers.has(filePath)) return;
  const reader = new SimpleIncrementalReader(filePath);
  readers.set(filePath, reader);
  const lines = await reader.coldStart();
  if (lines) processLines(lines, filePath);
}

async function pollReaders(files: SessionFiles): Promise<void> {
  // Ensure main reader exists
  await initReader(files.main);
  // Check for new subagent files
  for (const sub of files.subagents) {
    await initReader(sub);
  }
  // Poll each reader
  for (const [filePath, reader] of readers.entries()) {
    const lines = await reader.readNew();
    if (lines) processLines(lines, filePath);
  }
}

// ---------------------------------------------------------------------------
// HTTP POST
// ---------------------------------------------------------------------------

type PostMode = 'snapshot' | 'delta';

/** Full Agent shape expected by /api/ingest (matches src/types/index.ts + schema.ts). */
interface FullAgent {
  id: string;
  type: 'main' | 'subagent' | 'team';
  name: string;
  status: 'active' | 'idle' | 'completed' | 'failed';
  phase: 'spawning' | 'exploring' | 'implementing' | 'reporting' | 'done';
  startedAt: string;
  lastActiveAt: string;
  toolUseCount: number;
  transcriptPath: string;
  recentToolUseTimestamps: string[];
  tokensIn: number;
  tokensOut: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  estCostUsd: number;
}

/** Full AgentEvent shape expected by /api/ingest. Server assigns `seq`. */
interface FullEvent {
  id: string;
  agentId: string;
  agentName: string;
  type: 'agent_spawn' | 'agent_complete' | 'task_create' | 'task_update' | 'tool_use' | 'message';
  toolName?: string;
  summary: string;
  timestamp: string;
}

function toFullAgent(a: ReporterAgent): FullAgent {
  return {
    id: a.agentId,
    type: a.agentName === 'orchestrator' ? 'main' : 'subagent',
    name: a.agentName,
    status: 'active',
    phase: 'exploring',
    startedAt: a.firstSeenAt,
    lastActiveAt: a.lastActiveAt,
    toolUseCount: a.toolUseCount,
    transcriptPath: a.transcriptPath,
    recentToolUseTimestamps: [],
    tokensIn: 0,
    tokensOut: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    estCostUsd: 0,
  };
}

let eventCounter = 0;
function toFullEvent(e: ReporterEvent): FullEvent {
  eventCounter += 1;
  return {
    id: `${cfg.hostId}-${Date.now()}-${eventCounter}`,
    agentId: e.agentId,
    agentName: e.agentName,
    type: e.type as FullEvent['type'],
    toolName: e.toolName,
    summary: e.summary,
    timestamp: e.timestamp,
  };
}

interface IngestPayload {
  hostId: string;
  hostLabel?: string;
  watchedProjectPath: string;
  mode: PostMode;
  payload: {
    agents?: FullAgent[];
    events?: FullEvent[];
    removedAgentIds?: string[];
  };
}

let backoffMs = 1000;
const MAX_BACKOFF_MS = 30_000;

async function postToServer(mode: PostMode, timeoutMs?: number): Promise<boolean> {
  const effectiveTimeout = timeoutMs ?? cfg.httpTimeoutMs;

  let body: IngestPayload;
  if (mode === 'snapshot') {
    body = {
      hostId: cfg.hostId,
      hostLabel: cfg.hostLabel,
      watchedProjectPath: cfg.watchedProjectPath,
      mode: 'snapshot',
      payload: {
        agents: Array.from(agents.values()).map(toFullAgent),
        events: events.map(toFullEvent),
      },
    };
  } else {
    // delta — only changed agents + new events since last flush
    const deltaAgents =
      changedAgentIds.size > 0
        ? Array.from(changedAgentIds)
            .map((id) => agents.get(id))
            .filter((a): a is ReporterAgent => a !== undefined)
            .map(toFullAgent)
        : undefined;
    body = {
      hostId: cfg.hostId,
      hostLabel: cfg.hostLabel,
      watchedProjectPath: cfg.watchedProjectPath,
      mode: 'delta',
      payload: {
        agents: deltaAgents,
        events: newEvents.length > 0 ? newEvents.map(toFullEvent) : undefined,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const res = await fetch(`${cfg.targetUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      log('WARN', `POST /api/ingest returned ${res.status} ${res.statusText}`);
      return false;
    }

    // Reset backoff on success
    backoffMs = 1000;
    // Reset delta tracking
    changedAgentIds = new Set();
    newEvents = [];
    hasChanges = false;
    return true;
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    log('ERROR', `POST /api/ingest failed: ${msg}`);
    return false;
  }
}

async function postWithRetry(mode: PostMode): Promise<boolean> {
  let attempts = 0;
  while (true) {
    const ok = await postToServer(mode);
    if (ok) return true;
    attempts++;
    if (FLAG_ONCE && attempts === 1) {
      process.stderr.write(`[mc-reporter] ERROR: initial POST failed, exiting\n`);
      process.exit(1);
    }
    log('INFO', `Retrying in ${backoffMs}ms (attempt ${attempts})`);
    await sleep(backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let shuttingDown = false;
let sessionFound = false;

async function main(): Promise<void> {
  const watchedPath = resolveWatchedProjectPath();

  // Wait for a session to appear (or send empty snapshot immediately if --once)
  if (FLAG_ONCE) {
    // Attempt to find session; if none, just send empty snapshot
    const session = findSessionFiles(watchedPath);
    if (session) {
      await pollReaders(session);
    } else {
      log('INFO', 'no active session found — sending empty snapshot');
    }
    // First POST must be snapshot
    await postWithRetry('snapshot');
    process.exit(0);
  }

  // Normal mode: poll until session appears, then start tailing
  let pollWaitCount = 0;
  while (!sessionFound && !shuttingDown) {
    const session = findSessionFiles(watchedPath);
    if (session) {
      sessionFound = true;
      await pollReaders(session);
      break;
    }
    if (pollWaitCount === 0) {
      log('INFO', 'no active session found — waiting...');
    }
    pollWaitCount++;
    await sleep(5000);
  }

  if (shuttingDown) return;

  // Send initial snapshot immediately
  await postWithRetry('snapshot');

  // Schedule periodic tailing
  const batchTimer = setInterval(async () => {
    if (shuttingDown) return;
    const session = findSessionFiles(watchedPath);
    if (session) {
      // Add new subagent files that appeared since we started
      for (const sub of session.subagents) {
        await initReader(sub);
      }
      await pollReaders(session);
    }
    if (hasChanges) {
      await postToServer('delta');
    }
  }, cfg.batchIntervalMs);

  const snapshotTimer = setInterval(async () => {
    if (shuttingDown) return;
    await postToServer('snapshot');
  }, cfg.snapshotIntervalMs);

  // Keep process alive
  await new Promise<void>((resolve) => {
    function cleanup(): void {
      if (shuttingDown) return;
      shuttingDown = true;
      clearInterval(batchTimer);
      clearInterval(snapshotTimer);
      resolve();
    }
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  });

  // Graceful shutdown: flush one final snapshot with 3s timeout
  log('INFO', 'Shutting down — flushing final snapshot');
  await postToServer('snapshot', 3000);
  process.exit(0);
}

main().catch((err) => {
  log('ERROR', `Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
