import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Agent, Task } from '@/types';

// ---------------------------------------------------------------------------
// Mock the eventBus broadcast BEFORE importing the registry so the module
// picks up the mock when it is first evaluated.
// ---------------------------------------------------------------------------
vi.mock('@/lib/eventBus', () => ({
  broadcast: vi.fn(),
}));

import { broadcast } from '@/lib/eventBus';
import { Registry } from '@/server/watcher/registry';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    type: 'subagent',
    name: 'backend-dev',
    subagentType: 'backend-dev',
    status: 'active',
    phase: 'implementing',
    toolUseCount: 0,
    startedAt: '2026-04-15T10:00:00.000Z',
    lastActiveAt: '2026-04-15T10:00:00.000Z',
    transcriptPath: '/tmp/agent-1.jsonl',
    recentToolUseTimestamps: [],
    tokensIn: 0,
    tokensOut: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    estCostUsd: 0,
    hostId: 'local',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    subject: 'Build auth API',
    status: 'in_progress',
    blockedBy: [],
    blocks: [],
    createdAt: '2026-04-15T10:00:00.000Z',
    updatedAt: '2026-04-15T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Registry', () => {
  let registry: Registry;
  const mockBroadcast = broadcast as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registry = new Registry();
    mockBroadcast.mockClear();
  });

  // ── upsertAgent ────────────────────────────────────────────────────────

  describe('upsertAgent', () => {
    it('stores the agent', () => {
      const agent = makeAgent();
      registry.upsertAgent(agent);
      expect(registry.getAgent('agent-1')).toEqual(agent);
    });

    it('broadcasts an agent:update message via eventBus', () => {
      const agent = makeAgent();
      registry.upsertAgent(agent);
      expect(mockBroadcast).toHaveBeenCalledOnce();
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agent:update', payload: agent }),
      );
    });

    it('broadcast message contains a monotonically increasing seq', () => {
      registry.upsertAgent(makeAgent({ id: 'agent-1' }));
      registry.upsertAgent(makeAgent({ id: 'agent-2' }));
      const calls = mockBroadcast.mock.calls;
      const seq1 = (calls[0][0] as { seq: number }).seq;
      const seq2 = (calls[1][0] as { seq: number }).seq;
      expect(seq2).toBeGreaterThan(seq1);
    });

    it('replaces existing agent', () => {
      registry.upsertAgent(makeAgent({ status: 'active' }));
      registry.upsertAgent(makeAgent({ status: 'completed' }));
      expect(registry.getAgent('agent-1')?.status).toBe('completed');
    });
  });

  // ── addEvent ───────────────────────────────────────────────────────────

  describe('addEvent', () => {
    it('increments seq monotonically', () => {
      const e1 = registry.addEvent({
        id: 'ev-1', agentId: 'agent-1', agentName: 'main',
        type: 'tool_use', summary: 'First', timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      const e2 = registry.addEvent({
        id: 'ev-2', agentId: 'agent-1', agentName: 'main',
        type: 'tool_use', summary: 'Second', timestamp: '2026-04-15T10:00:01Z',
        hostId: 'local',
      });
      expect(e2.seq).toBeGreaterThan(e1.seq);
      expect(e2.seq).toBe(e1.seq + 1);
    });

    it('assigns seq from the shared counter (shared with upsertAgent/upsertTask)', () => {
      registry.upsertAgent(makeAgent()); // seq = 1
      const ev = registry.addEvent({
        id: 'ev-1', agentId: 'agent-1', agentName: 'main',
        type: 'message', summary: 'Hello', timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      expect(ev.seq).toBe(2);
    });

    it('broadcasts an event:new message', () => {
      registry.addEvent({
        id: 'ev-1', agentId: 'agent-1', agentName: 'main',
        type: 'task_create', summary: 'Created task', timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'event:new' }),
      );
    });

    it('returns the event with seq assigned', () => {
      const ev = registry.addEvent({
        id: 'ev-1', agentId: 'agent-1', agentName: 'main',
        type: 'tool_use', summary: 'Test', timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      expect(typeof ev.seq).toBe('number');
      expect(ev.seq).toBeGreaterThan(0);
    });
  });

  // ── snapshot ───────────────────────────────────────────────────────────

  describe('snapshot', () => {
    it('returns consistent state reflecting current agents, tasks, events', () => {
      registry.upsertAgent(makeAgent({ id: 'agent-1' }));
      registry.upsertAgent(makeAgent({ id: 'agent-2' }));
      registry.upsertTask(makeTask({ id: 'task-1' }));
      registry.addEvent({
        id: 'ev-1', agentId: 'agent-1', agentName: 'main',
        type: 'tool_use', summary: 'Did something', timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });

      const snap = registry.snapshot();
      expect(snap.agents).toHaveLength(2);
      expect(snap.tasks).toHaveLength(1);
      expect(snap.events).toHaveLength(1);
      expect(snap.lastSeq).toBe(registry.lastSeq);
    });

    it('snapshot lastSeq matches registry.lastSeq', () => {
      registry.upsertAgent(makeAgent());
      registry.addEvent({
        id: 'ev-1', agentId: 'agent-1', agentName: 'main',
        type: 'message', summary: 'Hi', timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      expect(registry.snapshot().lastSeq).toBe(registry.lastSeq);
    });

    it('snapshot events are capped at 200', () => {
      for (let i = 0; i < 250; i++) {
        registry.addEvent({
          id: `ev-${i}`, agentId: 'agent-1', agentName: 'main',
          type: 'tool_use', summary: `Event ${i}`, timestamp: '2026-04-15T10:00:00Z',
          hostId: 'local',
        });
      }
      const snap = registry.snapshot();
      expect(snap.events.length).toBeLessThanOrEqual(200);
    });

    it('snapshot includes mission metadata', () => {
      registry.sessionId = 'test-session';
      registry.cwd = '/tmp/project';
      const snap = registry.snapshot();
      expect(snap.mission.sessionId).toBe('test-session');
      expect(snap.mission.cwd).toBe('/tmp/project');
      expect(snap.mission.startedAt).toBeTruthy();
    });
  });

  // ── eventsSince ────────────────────────────────────────────────────────

  describe('eventsSince', () => {
    it('returns events with seq strictly greater than the given seq', () => {
      const e1 = registry.addEvent({
        id: 'ev-1', agentId: 'agent-1', agentName: 'main',
        type: 'tool_use', summary: 'A', timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      const e2 = registry.addEvent({
        id: 'ev-2', agentId: 'agent-1', agentName: 'main',
        type: 'tool_use', summary: 'B', timestamp: '2026-04-15T10:00:01Z',
        hostId: 'local',
      });
      const e3 = registry.addEvent({
        id: 'ev-3', agentId: 'agent-1', agentName: 'main',
        type: 'tool_use', summary: 'C', timestamp: '2026-04-15T10:00:02Z',
        hostId: 'local',
      });

      const since = registry.eventsSince(e1.seq);
      expect(since.map((e) => e.id)).toEqual([e2.id, e3.id]);
    });

    it('returns all events when seq is 0', () => {
      registry.addEvent({
        id: 'ev-1', agentId: 'a', agentName: 'main',
        type: 'tool_use', summary: 'First', timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      registry.addEvent({
        id: 'ev-2', agentId: 'a', agentName: 'main',
        type: 'tool_use', summary: 'Second', timestamp: '2026-04-15T10:00:01Z',
        hostId: 'local',
      });
      expect(registry.eventsSince(0)).toHaveLength(2);
    });

    it('returns empty array when seq is at or beyond latest', () => {
      const ev = registry.addEvent({
        id: 'ev-1', agentId: 'a', agentName: 'main',
        type: 'tool_use', summary: 'Only', timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      expect(registry.eventsSince(ev.seq)).toHaveLength(0);
    });

    it('returns events in ascending seq order', () => {
      for (let i = 0; i < 5; i++) {
        registry.addEvent({
          id: `ev-${i}`, agentId: 'a', agentName: 'main',
          type: 'tool_use', summary: `Event ${i}`, timestamp: '2026-04-15T10:00:00Z',
          hostId: 'local',
        });
      }
      const events = registry.eventsSince(0);
      for (let i = 1; i < events.length; i++) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
      }
    });
  });
});
