import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock eventBus BEFORE importing anything that uses the registry
// ---------------------------------------------------------------------------

vi.mock('@/lib/eventBus', () => ({
  broadcast: vi.fn(),
}));

vi.mock('pino', () => ({
  default: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { applyIngest } from '@/server/ingest/ingestHandler';
import { registry } from '@/server/watcher/registry';
import type { Agent, AgentEvent } from '@/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgent(id: string, hostId = 'test-host'): Agent {
  return {
    id,
    type: 'subagent',
    name: `agent-${id}`,
    subagentType: 'backend-dev',
    status: 'active',
    phase: 'implementing',
    toolUseCount: 0,
    startedAt: '2026-04-15T10:00:00.000Z',
    lastActiveAt: '2026-04-15T10:00:00.000Z',
    transcriptPath: `/tmp/${id}.jsonl`,
    recentToolUseTimestamps: [],
    tokensIn: 0,
    tokensOut: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    estCostUsd: 0,
    hostId,
    workDurationMs: 0,
    activeStreakStart: null,
  };
}

function makeEvent(
  id: string,
  agentId: string,
  hostId = 'test-host',
  timestamp?: string,
): Omit<AgentEvent, 'seq'> {
  return {
    id,
    agentId,
    agentName: `agent-${agentId}`,
    type: 'tool_use',
    summary: `Event ${id}`,
    timestamp: timestamp ?? '2026-04-15T10:00:00.000Z',
    hostId,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  registry.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyIngest', () => {
  // ── snapshot mode ────────────────────────────────────────────────────────

  describe('snapshot mode', () => {
    it('with empty payload, removes existing agents for that host via removeByHost', () => {
      // Pre-seed two agents on the host
      registry.upsertAgent(makeAgent('pre-existing-1', 'snap-host'));
      registry.upsertAgent(makeAgent('pre-existing-2', 'snap-host'));

      expect(registry.getAgents().filter((a) => a.hostId === 'snap-host')).toHaveLength(2);

      // Snapshot with empty agents array
      applyIngest('snap-host', undefined, undefined, { hostId: 'snap-host', mode: 'snapshot', payload: { agents: [], events: [] } });

      expect(registry.getAgents().filter((a) => a.hostId === 'snap-host')).toHaveLength(0);
    });

    it('replaces existing agents for that host but preserves agents from other hosts', () => {
      // Seed agents on two hosts
      registry.upsertAgent(makeAgent('host-a-1', 'host-a'));
      registry.upsertAgent(makeAgent('host-a-2', 'host-a'));
      registry.upsertAgent(makeAgent('host-b-1', 'host-b'));

      // Snapshot for host-a with only one agent
      applyIngest('host-a', undefined, undefined, {
        hostId: 'host-a',
        mode: 'snapshot',
        payload: { agents: [makeAgent('host-a-new', 'host-a')], events: [] },
      });

      const allAgents = registry.getAgents();
      const hostAAgents = allAgents.filter((a) => a.hostId === 'host-a');
      const hostBAgents = allAgents.filter((a) => a.hostId === 'host-b');

      // host-a now has only the new agent
      expect(hostAAgents).toHaveLength(1);
      expect(hostAAgents[0].id).toBe('host-a-new');

      // host-b is untouched
      expect(hostBAgents).toHaveLength(1);
      expect(hostBAgents[0].id).toBe('host-b-1');
    });

    it('stamps all agents with the server-side hostId regardless of payload hostId field', () => {
      const agentsWithWrongHost = [
        makeAgent('stamp-1', 'wrong-host'),
        makeAgent('stamp-2', 'also-wrong'),
      ];

      applyIngest('correct-host', undefined, undefined, {
        hostId: 'correct-host',
        mode: 'snapshot',
        payload: { agents: agentsWithWrongHost, events: [] },
      });

      const allAgents = registry.getAgents();
      const ingested = allAgents.filter((a) =>
        ['stamp-1', 'stamp-2'].includes(a.id),
      );
      expect(ingested).toHaveLength(2);
      ingested.forEach((a) => {
        expect(a.hostId).toBe('correct-host');
      });
    });
  });

  // ── delta mode ────────────────────────────────────────────────────────────

  describe('delta mode', () => {
    it('removedAgentIds only removes agents owned by the requesting host (not cross-host)', () => {
      // Seed agents on two hosts
      registry.upsertAgent(makeAgent('victim', 'host-requester'));
      registry.upsertAgent(makeAgent('bystander', 'host-other'));

      // Delta from host-requester tries to remove 'bystander' (cross-host)
      applyIngest('host-requester', undefined, undefined, {
        hostId: 'host-requester',
        mode: 'delta',
        payload: { removedAgentIds: ['victim', 'bystander'] },
      });

      const allAgents = registry.getAgents();
      // victim should be removed (same host)
      expect(allAgents.find((a) => a.id === 'victim')).toBeUndefined();
      // bystander should survive (different host)
      expect(allAgents.find((a) => a.id === 'bystander')).toBeDefined();
    });

    it('upserts agents in delta mode without removing other agents on the host', () => {
      registry.upsertAgent(makeAgent('existing', 'delta-host'));

      applyIngest('delta-host', undefined, undefined, {
        hostId: 'delta-host',
        mode: 'delta',
        payload: { agents: [makeAgent('new-agent', 'delta-host')], events: [] },
      });

      const allAgents = registry.getAgents();
      expect(allAgents.find((a) => a.id === 'existing')).toBeDefined();
      expect(allAgents.find((a) => a.id === 'new-agent')).toBeDefined();
    });

    it('stamps server-side hostId on delta agents regardless of payload field', () => {
      const deltaAgent = makeAgent('delta-stamp', 'payload-claimed-host');

      applyIngest('actual-host', undefined, undefined, {
        hostId: 'actual-host',
        mode: 'delta',
        payload: { agents: [deltaAgent], events: [] },
      });

      const agent = registry.getAgent('delta-stamp');
      expect(agent?.hostId).toBe('actual-host');
    });
  });

  // ── event timestamp clamping ──────────────────────────────────────────────

  describe('event timestamp clamping', () => {
    it('clamps event timestamp in the future to now', () => {
      vi.useFakeTimers();
      const now = new Date('2026-04-23T12:00:00.000Z');
      vi.setSystemTime(now);

      const futureTimestamp = '2026-12-31T23:59:59.000Z';
      const event = makeEvent('future-ev', 'agent-1', 'clamp-host', futureTimestamp);

      applyIngest('clamp-host', undefined, undefined, {
        hostId: 'clamp-host',
        mode: 'delta',
        payload: { events: [event as AgentEvent] },
      });

      const events = registry.eventsSince(0);
      const ingested = events.find((e) => e.id === 'future-ev');
      expect(ingested).toBeDefined();

      const storedMs = new Date(ingested!.timestamp).getTime();
      const nowMs = now.getTime();
      expect(storedMs).toBeLessThanOrEqual(nowMs);

      vi.useRealTimers();
    });

    it('preserves event timestamp that is in the past', () => {
      const pastTimestamp = '2024-01-01T00:00:00.000Z';
      const event = makeEvent('past-ev', 'agent-1', 'clamp-host', pastTimestamp);

      applyIngest('clamp-host', undefined, undefined, {
        hostId: 'clamp-host',
        mode: 'delta',
        payload: { events: [event as AgentEvent] },
      });

      const events = registry.eventsSince(0);
      const ingested = events.find((e) => e.id === 'past-ev');
      expect(ingested?.timestamp).toBe(pastTimestamp);
    });
  });

  // ── server seq assignment ─────────────────────────────────────────────────

  describe('server seq assignment', () => {
    it('assigns a fresh server seq to ingested events, ignoring any payload seq', () => {
      const eventWithSeq = {
        ...makeEvent('seq-test-ev', 'agent-1', 'seq-host'),
        seq: 99999, // Reporter-supplied seq that should be ignored
      } as AgentEvent;

      applyIngest('seq-host', undefined, undefined, {
        hostId: 'seq-host',
        mode: 'delta',
        payload: { events: [eventWithSeq] },
      });

      const events = registry.eventsSince(0);
      const ingested = events.find((e) => e.id === 'seq-test-ev');
      expect(ingested).toBeDefined();
      expect(ingested!.seq).not.toBe(99999);
      expect(typeof ingested!.seq).toBe('number');
    });
  });
});
