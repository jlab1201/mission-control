import { statSync } from 'fs';
import { findCurrentSession, getWatchedProjectPath } from './sessionLocator';
import type { SessionLocation } from './sessionLocator';
import { MainSessionWatcher } from './mainSessionWatcher';
import { SubagentWatcher } from './subagentWatcher';
import { registry } from './registry';
import { loadSnapshot } from '@/server/persistence/snapshotStore';
import { broadcast } from '@/lib/eventBus';
import type { Agent } from '@/types';
import {
  POLL_INTERVAL_MS,
  AGENT_ACTIVE_THRESHOLD_MS,
} from '@/lib/config/runtime';
import { localHostId, localHostLabel } from './watcherCore';

interface WatcherInstance {
  stop: () => void;
}

const g = globalThis as unknown as {
  __missionWatcher?: WatcherInstance;
  __missionRegistry?: typeof registry;
};

/**
 * Tears down the running watcher (if any) and starts a fresh one.
 * Called by POST /api/workspace/watch after the config is persisted.
 * Because getWatchedProjectPath() now reads the config file on every call,
 * simply restarting is enough — no extra path argument needed.
 */
export function restartWatcher(): void {
  if (g.__missionWatcher) {
    g.__missionWatcher.stop();
    g.__missionWatcher = undefined;
  }
  registry.clearLocal(localHostId());
  bootWatcher();
  broadcast({ type: 'snapshot', payload: registry.snapshot() });
}

export function ensureWatcherStarted(): void {
  // Idempotent — only boot once per process
  if (g.__missionWatcher) return;
  bootWatcher();
}

function bootWatcher(): void {
  // Register a placeholder so the flag is set even if session not found
  g.__missionWatcher = { stop: () => {} };

  // Set cwd unconditionally so the dashboard always reflects what we're pointed at,
  // even before any Claude session has started in that directory.
  registry.cwd = getWatchedProjectPath();

  const session = findCurrentSession();
  if (session) {
    attachToSession(session);
    return;
  }

  // No Claude session in the watched dir yet — common when a project was
  // just registered and the user hasn't started Claude in it yet, or starts
  // it shortly after MC. Poll for one to appear and attach when it does.
  console.warn(
    '[mission-control] No active Claude session yet — polling for one to appear.',
  );
  const discoveryInterval = setInterval(() => {
    const found = findCurrentSession();
    if (!found) return;
    clearInterval(discoveryInterval);
    console.info('[mission-control] Claude session detected:', found.sessionId);
    attachToSession(found);
  }, POLL_INTERVAL_MS);

  g.__missionWatcher = {
    stop: () => clearInterval(discoveryInterval),
  };
}

function attachToSession(session: SessionLocation): void {
  // Initialise registry session metadata
  registry.sessionId = session.sessionId;
  g.__missionRegistry = registry;

  // Create the "main" agent placeholder now (will be enriched by watcher).
  // Start as 'idle' unless the transcript was just touched — otherwise an old
  // session would boot with a spinning "working" ring even though nothing is
  // running.
  const now = new Date().toISOString();
  let initialStatus: Agent['status'] = 'idle';
  try {
    const ageMs = Date.now() - statSync(session.jsonlPath).mtimeMs;
    if (ageMs <= AGENT_ACTIVE_THRESHOLD_MS) initialStatus = 'active';
  } catch {
    // fall through — idle
  }
  const mainAgent: Agent = {
    id: 'main',
    type: 'main',
    name: 'main',
    status: initialStatus,
    phase: 'exploring',
    startedAt: now,
    lastActiveAt: now,
    toolUseCount: 0,
    transcriptPath: session.jsonlPath,
    recentToolUseTimestamps: [],
    tokensIn: 0,
    tokensOut: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    estCostUsd: 0,
    hostId: localHostId(),
    hostLabel: localHostLabel(),
    workDurationMs: 0,
    activeStreakStart: null,
  };
  registry.upsertAgent(mainAgent);

  const subagentWatcher = new SubagentWatcher(session.subagentsDir);

  const mainWatcher = new MainSessionWatcher(
    session.jsonlPath,
    session.subagentsDir,
    (agentId, transcriptPath) => {
      subagentWatcher.add(agentId, transcriptPath);
    },
  );

  // Boot: optionally hydrate from persisted snapshot, then cold-start
  const cwd = registry.cwd;
  const bootPromise = (async () => {
    // Hydrate before coldStart so the poll loop starts from last known state.
    // loadSnapshot returns null on first run or if the file is malformed.
    const saved = await loadSnapshot(cwd);
    if (saved) {
      registry.hydrate(saved);
      console.info('[mission-control] Registry hydrated from snapshot:', saved.savedAt);
    }
    await mainWatcher.coldStart();
    await subagentWatcher.coldStart();
  })();

  // Start the live poll loop only after cold-start succeeds, so the
  // interval never races with coldStart() over IncrementalReader.diskOffset.
  bootPromise.then(() => {
    const interval = setInterval(() => {
      Promise.all([mainWatcher.poll(), subagentWatcher.poll()]).catch((err) => {
        console.error('[mission-control] Poll error:', err);
      });
    }, POLL_INTERVAL_MS);

    g.__missionWatcher = {
      stop: () => clearInterval(interval),
    };

    // Push a snapshot so the dashboard transitions out of empty state
    // immediately when discovery finds the session, instead of waiting for
    // the next event from the live tail.
    broadcast({ type: 'snapshot', payload: registry.snapshot() });
  }).catch((err) => {
    console.error('[mission-control] Boot error:', err);
  });
}
