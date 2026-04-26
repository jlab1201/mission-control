import { describe, it, expect, beforeEach } from 'vitest';
import { useMissionStore } from '@/lib/store/missionStore';
import type { Agent, AgentEvent, MissionSnapshot, MissionStats, Task } from '@/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockAgent: Agent = {
  id: 'agent-1',
  type: 'subagent',
  name: 'backend-dev',
  subagentType: 'backend-dev',
  model: 'claude-sonnet-4-6',
  status: 'active',
  phase: 'implementing',
  toolUseCount: 5,
  startedAt: '2026-04-15T10:00:00.000Z',
  lastActiveAt: '2026-04-15T10:05:00.000Z',
  transcriptPath: '/tmp/agent-1.jsonl',
  recentToolUseTimestamps: [],
  color: 'green',
  tokensIn: 0,
  tokensOut: 0,
  cacheCreateTokens: 0,
  cacheReadTokens: 0,
  estCostUsd: 0,
  hostId: 'local',
  workDurationMs: 0,
  activeStreakStart: null,
};

const mockAgent2: Agent = {
  id: 'agent-2',
  type: 'subagent',
  name: 'frontend-dev',
  subagentType: 'frontend-dev',
  model: 'claude-sonnet-4-6',
  status: 'idle',
  phase: 'exploring',
  toolUseCount: 3,
  startedAt: '2026-04-15T10:01:00.000Z',
  lastActiveAt: '2026-04-15T10:04:00.000Z',
  transcriptPath: '/tmp/agent-2.jsonl',
  recentToolUseTimestamps: [],
  color: 'blue',
  tokensIn: 0,
  tokensOut: 0,
  cacheCreateTokens: 0,
  cacheReadTokens: 0,
  estCostUsd: 0,
  hostId: 'local',
  workDurationMs: 0,
  activeStreakStart: null,
};

const mockTask: Task = {
  id: 'task-1',
  subject: 'Implement auth API',
  status: 'in_progress',
  blockedBy: [],
  blocks: [],
  createdAt: '2026-04-15T10:00:00.000Z',
  updatedAt: '2026-04-15T10:01:00.000Z',
};

const mockTask2: Task = {
  id: 'task-2',
  subject: 'Build dashboard UI',
  status: 'pending',
  blockedBy: ['task-1'],
  blocks: [],
  createdAt: '2026-04-15T10:00:00.000Z',
  updatedAt: '2026-04-15T10:00:00.000Z',
};

const mockEvent: AgentEvent = {
  seq: 1,
  id: 'event-1',
  agentId: 'agent-1',
  agentName: 'backend-dev',
  type: 'tool_use',
  toolName: 'Edit',
  summary: 'Edit src/server/watcher/index.ts',
  timestamp: '2026-04-15T10:02:00.000Z',
  hostId: 'local',
};

const mockStats: MissionStats = {
  totalTasks: 16,
  tasksByStatus: {
    pending: 0,
    in_progress: 3,
    completed: 12,
    failed: 1,
  },
  activeAgents: 2,
  totalAgents: 5,
  toolUseCount: 42,
  velocityPer10Min: 4,
  sessionUptimeSeconds: 3600,
  hosts: [],
  missionWorkDurationMs: 0,
  missionActiveSince: null,
};

const mockSnapshot: MissionSnapshot = {
  mission: {
    sessionId: 'session-abc',
    cwd: '/path/to/project',
    startedAt: '2026-04-15T10:00:00.000Z',
    model: 'claude-opus-4-5',
  },
  agents: [mockAgent, mockAgent2],
  tasks: [mockTask, mockTask2],
  events: [mockEvent],
  stats: mockStats,
  lastSeq: 42,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('missionStore', () => {
  beforeEach(() => {
    useMissionStore.setState({
      agents: {},
      tasks: {},
      events: [],
      stats: null,
      mission: null,
      lastSeq: 0,
      sseStatus: 'connecting',
      lastEventReceivedAt: null,
    });
  });

  // ── hydrateFromSnapshot ──────────────────────────────────────────────────

  describe('hydrateFromSnapshot', () => {
    it('replaces all state atomically from snapshot', () => {
      useMissionStore.getState().hydrateFromSnapshot(mockSnapshot);
      const state = useMissionStore.getState();
      expect(Object.keys(state.agents)).toHaveLength(2);
      expect(Object.keys(state.tasks)).toHaveLength(2);
      expect(state.events).toHaveLength(1);
      expect(state.stats).toEqual(mockStats);
      expect(state.mission?.sessionId).toBe('session-abc');
      expect(state.lastSeq).toBe(42);
    });

    it('keys agents by id', () => {
      useMissionStore.getState().hydrateFromSnapshot(mockSnapshot);
      const { agents } = useMissionStore.getState();
      expect(agents['agent-1'].name).toBe('backend-dev');
      expect(agents['agent-2'].name).toBe('frontend-dev');
    });

    it('keys tasks by id', () => {
      useMissionStore.getState().hydrateFromSnapshot(mockSnapshot);
      const { tasks } = useMissionStore.getState();
      expect(tasks['task-1'].subject).toBe('Implement auth API');
      expect(tasks['task-2'].subject).toBe('Build dashboard UI');
    });

    it('sets lastSeq from snapshot', () => {
      useMissionStore.getState().hydrateFromSnapshot({ ...mockSnapshot, lastSeq: 99 });
      expect(useMissionStore.getState().lastSeq).toBe(99);
    });

    it('completely replaces prior state — old agents not retained', () => {
      // Pre-populate with extra agent
      useMissionStore.setState({ agents: { 'old-agent': mockAgent } });
      useMissionStore.getState().hydrateFromSnapshot({
        ...mockSnapshot,
        agents: [mockAgent2],
      });
      const { agents } = useMissionStore.getState();
      expect(agents['old-agent']).toBeUndefined();
      expect(agents['agent-2']).toBeDefined();
    });

    it('handles empty agents and tasks arrays', () => {
      useMissionStore.getState().hydrateFromSnapshot({
        ...mockSnapshot,
        agents: [],
        tasks: [],
        events: [],
      });
      const state = useMissionStore.getState();
      expect(state.agents).toEqual({});
      expect(state.tasks).toEqual({});
      expect(state.events).toHaveLength(0);
    });
  });

  // ── upsertAgent ──────────────────────────────────────────────────────────

  describe('upsertAgent', () => {
    it('adds a new agent to an empty store', () => {
      useMissionStore.getState().upsertAgent(mockAgent);
      const { agents } = useMissionStore.getState();
      expect(agents['agent-1']).toEqual(mockAgent);
    });

    it('adds multiple agents preserving all', () => {
      useMissionStore.getState().upsertAgent(mockAgent);
      useMissionStore.getState().upsertAgent(mockAgent2);
      expect(Object.keys(useMissionStore.getState().agents)).toHaveLength(2);
    });

    it('replaces existing agent with same id', () => {
      useMissionStore.getState().upsertAgent(mockAgent);
      const updated: Agent = { ...mockAgent, status: 'idle', phase: 'reporting' };
      useMissionStore.getState().upsertAgent(updated);
      const { agents } = useMissionStore.getState();
      expect(Object.keys(agents)).toHaveLength(1);
      expect(agents['agent-1'].status).toBe('idle');
      expect(agents['agent-1'].phase).toBe('reporting');
    });

    it('preserves other agents when upserting one', () => {
      useMissionStore.getState().upsertAgent(mockAgent);
      useMissionStore.getState().upsertAgent(mockAgent2);
      const updated: Agent = { ...mockAgent, toolUseCount: 99 };
      useMissionStore.getState().upsertAgent(updated);
      const { agents } = useMissionStore.getState();
      expect(agents['agent-1'].toolUseCount).toBe(99);
      expect(agents['agent-2']).toEqual(mockAgent2);
    });
  });

  // ── upsertTask ───────────────────────────────────────────────────────────

  describe('upsertTask', () => {
    it('adds a new task to an empty store', () => {
      useMissionStore.getState().upsertTask(mockTask);
      expect(useMissionStore.getState().tasks['task-1']).toEqual(mockTask);
    });

    it('adds multiple tasks preserving all', () => {
      useMissionStore.getState().upsertTask(mockTask);
      useMissionStore.getState().upsertTask(mockTask2);
      expect(Object.keys(useMissionStore.getState().tasks)).toHaveLength(2);
    });

    it('replaces existing task with same id', () => {
      useMissionStore.getState().upsertTask(mockTask);
      const updated: Task = { ...mockTask, status: 'completed' };
      useMissionStore.getState().upsertTask(updated);
      const { tasks } = useMissionStore.getState();
      expect(Object.keys(tasks)).toHaveLength(1);
      expect(tasks['task-1'].status).toBe('completed');
    });

    it('preserves other tasks when upserting one', () => {
      useMissionStore.getState().upsertTask(mockTask);
      useMissionStore.getState().upsertTask(mockTask2);
      const updated: Task = { ...mockTask, subject: 'Updated subject' };
      useMissionStore.getState().upsertTask(updated);
      const { tasks } = useMissionStore.getState();
      expect(tasks['task-1'].subject).toBe('Updated subject');
      expect(tasks['task-2']).toEqual(mockTask2);
    });
  });

  // ── addEvent ─────────────────────────────────────────────────────────────

  describe('addEvent', () => {
    it('prepends event to list (newest first)', () => {
      useMissionStore.getState().addEvent(mockEvent);
      expect(useMissionStore.getState().events[0]).toEqual(mockEvent);
    });

    it('maintains newest-first order', () => {
      const e1: AgentEvent = { ...mockEvent, seq: 1, id: 'e1', summary: 'First' };
      const e2: AgentEvent = { ...mockEvent, seq: 2, id: 'e2', summary: 'Second' };
      useMissionStore.getState().addEvent(e1);
      useMissionStore.getState().addEvent(e2);
      const { events } = useMissionStore.getState();
      expect(events[0].summary).toBe('Second');
      expect(events[1].summary).toBe('First');
    });

    it('caps events at 200', () => {
      for (let i = 0; i < 201; i++) {
        useMissionStore.getState().addEvent({
          ...mockEvent,
          seq: i + 1,
          id: `event-${i}`,
          summary: `Event ${i}`,
        });
      }
      expect(useMissionStore.getState().events.length).toBe(200);
    });

    it('drops oldest events when over 200 cap', () => {
      for (let i = 0; i < 201; i++) {
        useMissionStore.getState().addEvent({
          ...mockEvent,
          seq: i + 1,
          id: `event-${i}`,
          summary: `Event ${i}`,
        });
      }
      const { events } = useMissionStore.getState();
      // Newest should be Event 200 (last added)
      expect(events[0].summary).toBe('Event 200');
      // Oldest (Event 0) should be dropped
      expect(events.find((e) => e.summary === 'Event 0')).toBeUndefined();
    });

    it('updates lastSeq when event seq is higher', () => {
      useMissionStore.getState().addEvent({ ...mockEvent, seq: 10 });
      expect(useMissionStore.getState().lastSeq).toBe(10);
    });

    it('does not decrease lastSeq for lower seq event', () => {
      useMissionStore.getState().addEvent({ ...mockEvent, seq: 50 });
      useMissionStore.getState().addEvent({ ...mockEvent, seq: 5, id: 'old' });
      expect(useMissionStore.getState().lastSeq).toBe(50);
    });

    it('updates lastSeq with each higher seq event', () => {
      useMissionStore.getState().addEvent({ ...mockEvent, seq: 1 });
      useMissionStore.getState().addEvent({ ...mockEvent, seq: 5, id: 'e2' });
      useMissionStore.getState().addEvent({ ...mockEvent, seq: 3, id: 'e3' });
      expect(useMissionStore.getState().lastSeq).toBe(5);
    });
  });

  // ── setStats ─────────────────────────────────────────────────────────────

  describe('setStats', () => {
    it('stores mission stats', () => {
      useMissionStore.getState().setStats(mockStats);
      expect(useMissionStore.getState().stats).toEqual(mockStats);
    });

    it('overwrites previous stats', () => {
      useMissionStore.getState().setStats(mockStats);
      const updated: MissionStats = { ...mockStats, activeAgents: 99 };
      useMissionStore.getState().setStats(updated);
      expect(useMissionStore.getState().stats?.activeAgents).toBe(99);
    });
  });

  // ── setSseStatus ─────────────────────────────────────────────────────────

  describe('setSseStatus', () => {
    it('updates to connected', () => {
      useMissionStore.getState().setSseStatus('connected');
      expect(useMissionStore.getState().sseStatus).toBe('connected');
    });

    it('updates to disconnected', () => {
      useMissionStore.getState().setSseStatus('disconnected');
      expect(useMissionStore.getState().sseStatus).toBe('disconnected');
    });

    it('updates to reconnecting', () => {
      useMissionStore.getState().setSseStatus('reconnecting');
      expect(useMissionStore.getState().sseStatus).toBe('reconnecting');
    });

    it('starts as connecting by default', () => {
      expect(useMissionStore.getState().sseStatus).toBe('connecting');
    });
  });

  // ── touchLastReceived ────────────────────────────────────────────────────

  describe('touchLastReceived', () => {
    it('sets lastEventReceivedAt to a valid ISO timestamp', () => {
      const before = Date.now();
      useMissionStore.getState().touchLastReceived();
      const after = Date.now();
      const ts = useMissionStore.getState().lastEventReceivedAt;
      expect(ts).not.toBeNull();
      const tsMs = new Date(ts!).getTime();
      expect(tsMs).toBeGreaterThanOrEqual(before);
      expect(tsMs).toBeLessThanOrEqual(after);
    });

    it('updates lastEventReceivedAt on each call', () => {
      useMissionStore.getState().touchLastReceived();
      const first = useMissionStore.getState().lastEventReceivedAt;
      useMissionStore.getState().touchLastReceived();
      const second = useMissionStore.getState().lastEventReceivedAt;
      // Both should be valid ISO strings; second should be >= first
      expect(new Date(second!).getTime()).toBeGreaterThanOrEqual(new Date(first!).getTime());
    });

    it('starts as null before any touch', () => {
      expect(useMissionStore.getState().lastEventReceivedAt).toBeNull();
    });
  });
});
