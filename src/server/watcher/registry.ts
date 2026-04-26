import { broadcast } from '@/lib/eventBus';
import { scheduleSave } from '@/server/persistence/snapshotStore';
import type {
  Agent,
  Task,
  AgentEvent,
  MissionSnapshot,
  MissionStats,
  RegistrySnapshot,
  TaskStatus,
} from '@/types';
import { getAllHosts, hydrateHosts } from '@/server/ingest/hostRegistry';
import { EVENT_RING_BUFFER_SIZE, SNAPSHOT_EVENT_LIMIT } from '@/lib/config/runtime';
import { localHostId, localHostLabel } from './watcherCore';

const RING_BUFFER_SIZE = EVENT_RING_BUFFER_SIZE;

/**
 * Computes the next Agent record with workDurationMs / activeStreakStart
 * managed based on the status transition between `prev` and `incoming`.
 *
 * Callers pass an Agent with whatever workDurationMs / activeStreakStart
 * values they like (typically zero / null at creation time); this function
 * always overrides them so transition tracking is centralised here.
 *
 * Transitions:
 *   - prev=non-active → next=active: open a new streak (activeStreakStart=now)
 *   - prev=active → next=non-active: accumulate the streak into workDurationMs
 *   - active → active: keep the existing streak start, no accumulation yet
 *   - non-active → non-active: nothing changes
 *   - new agent (no prev), starting active: open streak from now
 *   - new agent (no prev), starting non-active: leave at 0 / null
 */
export function applyDurationBookkeeping(
  prev: Agent | undefined,
  incoming: Agent,
): Agent {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const prevActive = prev?.status === 'active';
  const nextActive = incoming.status === 'active';

  let workDurationMs = prev?.workDurationMs ?? 0;
  let activeStreakStart: string | null = prev?.activeStreakStart ?? null;

  if (prevActive && !nextActive && activeStreakStart) {
    // Closing a streak — accumulate elapsed into the total.
    workDurationMs += Math.max(0, now - new Date(activeStreakStart).getTime());
    activeStreakStart = null;
  } else if (!prevActive && nextActive) {
    // Opening a new streak.
    activeStreakStart = nowIso;
  }
  // (active→active and non→non: leave fields untouched)

  return { ...incoming, workDurationMs, activeStreakStart };
}

export class Registry {
  private agents = new Map<string, Agent>();
  private tasks = new Map<string, Task>();
  /** Ring buffer, newest first */
  private events: AgentEvent[] = [];
  lastSeq = 0;
  readonly missionStart: Date;
  sessionId = '';
  cwd = '';
  /** Pending coalesced stats broadcast timer handle */
  private statsBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Mission-level accumulated work duration (ms). Increments while at least
   * one local agent is in 'active' status. See recomputeMissionDuration().
   */
  private missionWorkDurationMs = 0;
  /**
   * ISO timestamp of the current mission-active streak, or null when no agent
   * is active. The "live" portion of the displayed duration is computed as
   * `now - missionActiveSince` and added to missionWorkDurationMs by readers.
   */
  private missionActiveSince: string | null = null;

  // ── Batch state ───────────────────────────────────────────────────────────
  private inBatch = false;
  private batchedAgentUpserts = new Map<string, Agent>();
  private batchedAgentDeletes = new Set<string>();
  private batchedTaskUpserts = new Map<string, Task>();
  private batchedEvents: AgentEvent[] = [];
  private batchSaveRequested = false;

  constructor() {
    this.missionStart = new Date();
  }

  private nextSeq(): number {
    return ++this.lastSeq;
  }

  /**
   * Coalesces rapid successive mutations into a single stats:update broadcast.
   * The broadcast fires on the next event-loop tick, so multiple registry
   * mutations in the same synchronous poll cycle produce only one stats frame.
   */
  private scheduleStatsBroadcast(): void {
    if (this.inBatch) return; // flushed in bulk at end of batch
    if (this.statsBroadcastTimer !== null) return;
    this.statsBroadcastTimer = setTimeout(() => {
      this.statsBroadcastTimer = null;
      const seq = this.nextSeq();
      broadcast({ type: 'stats:update', seq, payload: this.computeStats() });
    }, 0);
  }

  upsertAgent(agent: Agent): void {
    const prev = this.agents.get(agent.id);
    const next = applyDurationBookkeeping(prev, agent);
    this.agents.set(next.id, next);
    this.recomputeMissionDuration();
    if (this.inBatch) {
      // If this id was previously queued for delete, the upsert wins (last-write)
      this.batchedAgentDeletes.delete(next.id);
      this.batchedAgentUpserts.set(next.id, next);
      this.batchSaveRequested = true;
      return;
    }
    const seq = this.nextSeq();
    broadcast({ type: 'agent:update', seq, payload: next });
    this.scheduleStatsBroadcast();
    if (this.cwd) scheduleSave(this.cwd, this.toSnapshot());
  }

  removeAgent(id: string): void {
    if (!this.agents.has(id)) return;
    this.agents.delete(id);
    this.recomputeMissionDuration();
    if (this.inBatch) {
      // Delete wins over any pending upsert for same id
      this.batchedAgentUpserts.delete(id);
      this.batchedAgentDeletes.add(id);
      this.batchSaveRequested = true;
      return;
    }
    const seq = this.nextSeq();
    broadcast({ type: 'agent:delete', seq, payload: { id } });
    this.scheduleStatsBroadcast();
    if (this.cwd) scheduleSave(this.cwd, this.toSnapshot());
  }

  /**
   * Refreshes mission-level duration state based on whether any agent is
   * currently active. Called after every agent insert/update/delete.
   *
   * - non-active → active: opens missionActiveSince at now
   * - active → non-active: accumulates the streak into missionWorkDurationMs
   * - same union: nothing changes
   */
  private recomputeMissionDuration(): void {
    const anyActive = Array.from(this.agents.values()).some(
      (a) => a.status === 'active',
    );
    const wasActive = this.missionActiveSince !== null;
    if (anyActive && !wasActive) {
      this.missionActiveSince = new Date().toISOString();
    } else if (!anyActive && wasActive && this.missionActiveSince) {
      this.missionWorkDurationMs += Math.max(
        0,
        Date.now() - new Date(this.missionActiveSince).getTime(),
      );
      this.missionActiveSince = null;
    }
  }

  /** Reset all in-memory state. Used by tests and direct callers. */
  clear(): void {
    this.agents.clear();
    this.tasks.clear();
    this.events = [];
    this.lastSeq = 0;
    this.sessionId = '';
    this.cwd = '';
    this.missionWorkDurationMs = 0;
    this.missionActiveSince = null;
    // Cancel any pending stats broadcast — stale after a full reset
    if (this.statsBroadcastTimer !== null) {
      clearTimeout(this.statsBroadcastTimer);
      this.statsBroadcastTimer = null;
    }
  }

  upsertTask(task: Task): void {
    this.tasks.set(task.id, task);
    if (this.inBatch) {
      this.batchedTaskUpserts.set(task.id, task);
      this.batchSaveRequested = true;
      return;
    }
    const seq = this.nextSeq();
    broadcast({ type: 'task:replace', seq, payload: task });
    this.scheduleStatsBroadcast();
    if (this.cwd) scheduleSave(this.cwd, this.toSnapshot());
  }

  addEvent(e: Omit<AgentEvent, 'seq'>): AgentEvent {
    const seq = this.nextSeq();
    const event: AgentEvent = { ...e, seq };

    // Prepend (newest first) and cap at ring buffer size
    this.events.unshift(event);
    if (this.events.length > RING_BUFFER_SIZE) {
      this.events.length = RING_BUFFER_SIZE;
    }

    if (this.inBatch) {
      this.batchedEvents.push(event);
      this.batchSaveRequested = true;
      return event;
    }

    broadcast({ type: 'event:new', seq, payload: event });
    this.scheduleStatsBroadcast();
    if (this.cwd) scheduleSave(this.cwd, this.toSnapshot());
    return event;
  }

  getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  eventsSince(seq: number): AgentEvent[] {
    // Events are newest-first; find all with seq > requested
    return this.events.filter((e) => e.seq > seq).reverse();
  }

  // ── Host helpers ──────────────────────────────────────────────────────────

  /** Returns all agents belonging to the given hostId. */
  getByHost(hostId: string): Agent[] {
    return this.getAgents().filter((a) => a.hostId === hostId);
  }

  /**
   * Deletes agents whose hostId matches AND whose id is NOT in exceptIds.
   * Returns the list of deleted ids.
   * Broadcasts agent:delete per id (or enqueues into batch buffer if inBatch).
   */
  removeByHost(hostId: string, exceptIds: Set<string>): string[] {
    const deleted: string[] = [];
    for (const agent of this.getByHost(hostId)) {
      if (!exceptIds.has(agent.id)) {
        deleted.push(agent.id);
        this.removeAgent(agent.id);
      }
    }
    return deleted;
  }

  /**
   * Runs `fn` with batch mode enabled.
   * While inBatch is true, all mutations queue into per-batch buffers.
   * On completion, flushes: agent:update, agent:delete, task:replace, event:new
   * (deduped — last write wins per id), then one coalesced stats:update and
   * one scheduleSave if any mutation occurred.
   * Always resets batch state in a finally block even if fn throws.
   */
  applyBatch<T>(fn: () => T): T {
    this.inBatch = true;
    this.batchedAgentUpserts = new Map();
    this.batchedAgentDeletes = new Set();
    this.batchedTaskUpserts = new Map();
    this.batchedEvents = [];
    this.batchSaveRequested = false;

    let result: T;
    try {
      result = fn();
    } finally {
      this.inBatch = false;
      // Flush — only emit if something actually happened
      const anyMutation =
        this.batchedAgentUpserts.size > 0 ||
        this.batchedAgentDeletes.size > 0 ||
        this.batchedTaskUpserts.size > 0 ||
        this.batchedEvents.length > 0 ||
        this.batchSaveRequested;

      if (anyMutation) {
        for (const agent of this.batchedAgentUpserts.values()) {
          if (!this.batchedAgentDeletes.has(agent.id)) {
            broadcast({ type: 'agent:update', seq: this.nextSeq(), payload: agent });
          }
        }
        for (const id of this.batchedAgentDeletes) {
          broadcast({ type: 'agent:delete', seq: this.nextSeq(), payload: { id } });
        }
        for (const task of this.batchedTaskUpserts.values()) {
          broadcast({ type: 'task:replace', seq: this.nextSeq(), payload: task });
        }
        for (const event of this.batchedEvents) {
          broadcast({ type: 'event:new', seq: event.seq, payload: event });
        }
        // One coalesced stats:update
        broadcast({ type: 'stats:update', seq: this.nextSeq(), payload: this.computeStats() });
        // One scheduleSave
        if (this.cwd) scheduleSave(this.cwd, this.toSnapshot());
      }

      // Clear batch buffers
      this.batchedAgentUpserts = new Map();
      this.batchedAgentDeletes = new Set();
      this.batchedTaskUpserts = new Map();
      this.batchedEvents = [];
      this.batchSaveRequested = false;
    }
    return result!;
  }

  /**
   * Wipes only local-owned state for the given hostId.
   * Used by restartWatcher() when switching the locally-watched project.
   * Does NOT affect agents/events belonging to other hosts.
   * Resets sessionId/cwd to empty. Does NOT reset lastSeq (keeps it monotonic).
   * TODO: tasks have no hostId today — all tasks are wiped; assign task.hostId in a future task.
   * Wraps everything in applyBatch for a single coalesced broadcast.
   */
  clearLocal(hostId: string): void {
    this.applyBatch(() => {
      // Remove all agents for this host (no exceptions)
      this.removeByHost(hostId, new Set());
      // Wipe all tasks (no hostId on tasks yet)
      for (const id of [...this.tasks.keys()]) {
        this.tasks.delete(id);
      }
      // Filter events to drop those belonging to this host
      this.events = this.events.filter((e) => e.hostId !== hostId);
      // Reset session metadata for local
      this.sessionId = '';
      this.cwd = '';
      this.batchSaveRequested = true;
    });
    // Mission-level duration is local-only state — clear it when wiping the
    // local host. Multi-host duration aggregation is out of scope here.
    this.missionWorkDurationMs = 0;
    this.missionActiveSince = null;
    // Cancel any pending async stats broadcast — state is stale after clearLocal
    if (this.statsBroadcastTimer !== null) {
      clearTimeout(this.statsBroadcastTimer);
      this.statsBroadcastTimer = null;
    }
  }

  computeStats(): MissionStats {
    const tasks = this.getTasks();
    const agents = this.getAgents();

    const tasksByStatus: Record<TaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    };
    let completedCount10Min = 0;
    const cutoff10Min = Date.now() - 10 * 60 * 1000;

    for (const t of tasks) {
      tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
      if (
        t.status === 'completed' &&
        t.completedAt &&
        new Date(t.completedAt).getTime() > cutoff10Min
      ) {
        completedCount10Min++;
      }
    }

    const totalToolUses = agents.reduce((sum, a) => sum + a.toolUseCount, 0);
    const lastEventAt = this.events[0]?.timestamp;

    // ── Hosts summary ───────────────────────────────────────────────────────
    const hostMap = new Map<string, {
      hostLabel?: string;
      lastSeenAt: string;
      agentCount: number;
      activeAgentCount: number;
    }>();

    // Always include the local host entry, even if zero agents
    const localId = localHostId();
    const localLabel = localHostLabel();
    hostMap.set(localId, {
      hostLabel: localLabel,
      lastSeenAt: new Date(0).toISOString(),
      agentCount: 0,
      activeAgentCount: 0,
    });

    for (const agent of agents) {
      const entry = hostMap.get(agent.hostId);
      const agentLastSeen = agent.lastActiveAt;
      if (entry) {
        entry.agentCount++;
        if (agent.status === 'active') entry.activeAgentCount++;
        if (agentLastSeen > entry.lastSeenAt) entry.lastSeenAt = agentLastSeen;
      } else {
        hostMap.set(agent.hostId, {
          hostLabel: agent.hostLabel,
          lastSeenAt: agentLastSeen,
          agentCount: 1,
          activeAgentCount: agent.status === 'active' ? 1 : 0,
        });
      }
    }

    const hosts = Array.from(hostMap.entries()).map(([hostId, data]) => ({
      hostId,
      hostLabel: data.hostLabel,
      lastSeenAt: data.lastSeenAt,
      agentCount: data.agentCount,
      activeAgentCount: data.activeAgentCount,
    }));

    return {
      totalTasks: tasks.length,
      tasksByStatus,
      activeAgents: agents.filter((a) => a.status === 'active').length,
      totalAgents: agents.length,
      toolUseCount: totalToolUses,
      velocityPer10Min: completedCount10Min,
      sessionUptimeSeconds: Math.floor(
        (Date.now() - this.missionStart.getTime()) / 1000,
      ),
      lastEventAt,
      hosts,
      missionWorkDurationMs: this.missionWorkDurationMs,
      missionActiveSince: this.missionActiveSince,
    };
  }

  /** Materialise current registry state into a JSON-safe snapshot for persistence. */
  toSnapshot(): RegistrySnapshot {
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      sessionId: this.sessionId || null,
      cwd: this.cwd || null,
      lastSeq: this.lastSeq,
      agents: this.getAgents(),
      tasks: this.getTasks(),
      // events is newest-first; eventsSince(0) returns oldest-first — reverse
      // back so the ring buffer is stored oldest-first (natural read order).
      events: this.eventsSince(0).slice(-RING_BUFFER_SIZE),
      knownHosts: getAllHosts(),
      missionWorkDurationMs: this.missionWorkDurationMs,
      missionActiveSince: this.missionActiveSince,
    };
  }

  /**
   * Repopulate registry from a previously saved snapshot.
   * Called once during boot, before coldStart(), so the poll loop
   * picks up from the last known state instead of starting empty.
   * If snapshot.version === 1, stamps hostId/hostLabel on all agents and events
   * using the current MC_HOST_ID / MC_HOST_LABEL env vars (v1 migration).
   */
  hydrate(snapshot: RegistrySnapshot): void {
    this.agents.clear();
    this.tasks.clear();
    this.events = [];

    const isV1 = snapshot.version === 1;
    const fallbackHostId = localHostId();
    const fallbackHostLabel = localHostLabel();
    const savedAtMs = new Date(snapshot.savedAt).getTime();

    for (const agent of snapshot.agents) {
      const base: Agent = isV1
        ? { ...agent, hostId: agent.hostId ?? fallbackHostId, hostLabel: agent.hostLabel ?? fallbackHostLabel }
        : agent;

      // Default the new duration fields for snapshots that predate them.
      let workDurationMs = base.workDurationMs ?? 0;
      let activeStreakStart: string | null = base.activeStreakStart ?? null;

      // Freeze any in-flight streak: credit work up to when the snapshot was
      // saved (verifiable from the file), but don't credit the gap between
      // snapshot save and now (we have no way to know if MC was running).
      if (activeStreakStart) {
        const streakStartMs = new Date(activeStreakStart).getTime();
        workDurationMs += Math.max(0, savedAtMs - streakStartMs);
        activeStreakStart = null;
      }

      this.agents.set(base.id, { ...base, workDurationMs, activeStreakStart });
    }
    for (const task of snapshot.tasks) {
      this.tasks.set(task.id, task);
    }

    // Restore ring buffer: snapshot stores oldest-first, buffer is newest-first
    const hydratedEvents: AgentEvent[] = snapshot.events.map((e) =>
      isV1
        ? { ...e, hostId: e.hostId ?? fallbackHostId, hostLabel: e.hostLabel ?? fallbackHostLabel }
        : e,
    );
    this.events = [...hydratedEvents].reverse();
    if (this.events.length > RING_BUFFER_SIZE) {
      this.events.length = RING_BUFFER_SIZE;
    }

    this.lastSeq = snapshot.lastSeq;
    this.sessionId = snapshot.sessionId ?? '';
    this.cwd = snapshot.cwd ?? '';

    // Mission-level duration: same freeze logic as per-agent.
    this.missionWorkDurationMs = snapshot.missionWorkDurationMs ?? 0;
    const savedMissionStreak = snapshot.missionActiveSince ?? null;
    if (savedMissionStreak) {
      const streakStartMs = new Date(savedMissionStreak).getTime();
      this.missionWorkDurationMs += Math.max(0, savedAtMs - streakStartMs);
    }
    this.missionActiveSince = null;

    // Hydrate known hosts (optional field — absent in older v2 snapshots)
    hydrateHosts(snapshot.knownHosts ?? []);
  }

  snapshot(): MissionSnapshot {
    return {
      mission: {
        sessionId: this.sessionId,
        cwd: this.cwd,
        startedAt: this.missionStart.toISOString(),
        model: this.agents.get('main')?.model,
      },
      agents: this.getAgents(),
      tasks: this.getTasks(),
      events: this.events.slice(0, SNAPSHOT_EVENT_LIMIT),
      stats: this.computeStats(),
      lastSeq: this.lastSeq,
    };
  }
}

// ── globalThis singleton ──────────────────────────────────────────────────────

const g = globalThis as unknown as { __missionRegistry?: Registry };
if (!g.__missionRegistry) {
  g.__missionRegistry = new Registry();
}

export const registry = g.__missionRegistry;
