import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSSE } from '@/hooks/useSSE';
import { useMissionStore } from '@/lib/store/missionStore';
import type { SSEMessage, MissionSnapshot } from '@/types';

// ---------------------------------------------------------------------------
// Minimal EventSource mock
// ---------------------------------------------------------------------------

type EventSourceInstance = {
  url: string;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
  // Test helpers
  _simulateOpen: () => void;
  _simulateMessage: (data: unknown) => void;
  _simulateError: () => void;
};

let instances: EventSourceInstance[] = [];

const MockEventSource = vi.fn(function (this: EventSourceInstance, url: string) {
  this.url = url;
  this.onopen = null;
  this.onmessage = null;
  this.onerror = null;
  this.close = vi.fn();
  this._simulateOpen = () => {
    if (this.onopen) this.onopen(new Event('open'));
  };
  this._simulateMessage = (data: unknown) => {
    const event = new MessageEvent('message', { data: JSON.stringify(data) });
    if (this.onmessage) this.onmessage(event);
  };
  this._simulateError = () => {
    if (this.onerror) this.onerror(new Event('error'));
  };
  instances.push(this);
}) as unknown as typeof EventSource;

// ---------------------------------------------------------------------------
// Minimal snapshot fixture
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<MissionSnapshot> = {}): MissionSnapshot {
  return {
    agents: [],
    tasks: [],
    events: [],
    lastSeq: 0,
    mission: {
      sessionId: 'sess-1',
      cwd: '/tmp/project',
      startedAt: '2026-04-15T10:00:00.000Z',
    },
    stats: {
      totalTasks: 0,
      tasksByStatus: { pending: 0, in_progress: 0, completed: 0, failed: 0 },
      activeAgents: 0,
      totalAgents: 0,
      toolUseCount: 0,
      velocityPer10Min: 0,
      sessionUptimeSeconds: 0,
      hosts: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  instances = [];
  vi.useFakeTimers();
  // Install mock before each test
  vi.stubGlobal('EventSource', MockEventSource);

  // Reset store to clean state
  useMissionStore.setState({
    agents: {},
    tasks: {},
    events: [],
    lastSeq: 0,
    stats: null,
    sseStatus: 'connecting',
    lastEventReceivedAt: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSSE', () => {
  it('creates an EventSource on mount with the given baseUrl', () => {
    renderHook(() => useSSE('/api/stream'));
    expect(MockEventSource).toHaveBeenCalledOnce();
    expect(instances[0].url).toBe('/api/stream');
  });

  it('sets sseStatus to "connecting" before the connection opens', () => {
    renderHook(() => useSSE('/api/stream'));
    expect(useMissionStore.getState().sseStatus).toBe('connecting');
  });

  it('sets sseStatus to "connected" when onopen fires', () => {
    renderHook(() => useSSE('/api/stream'));
    act(() => {
      instances[0]._simulateOpen();
    });
    expect(useMissionStore.getState().sseStatus).toBe('connected');
  });

  it('dispatches hydrateFromSnapshot on a snapshot message', () => {
    renderHook(() => useSSE('/api/stream'));
    const spy = vi.spyOn(useMissionStore.getState(), 'hydrateFromSnapshot');
    const snap = makeSnapshot({ lastSeq: 5 });

    act(() => {
      instances[0]._simulateMessage({ type: 'snapshot', payload: snap } satisfies SSEMessage);
    });

    // lastSeq in store should now be 5 (hydrate was applied)
    expect(useMissionStore.getState().lastSeq).toBe(5);
    spy.mockRestore();
  });

  it('dispatches upsertAgent on an agent:update message', () => {
    renderHook(() => useSSE('/api/stream'));
    act(() => {
      instances[0]._simulateMessage({
        type: 'agent:update',
        seq: 1,
        payload: {
          id: 'agent-1',
          type: 'subagent',
          name: 'backend-dev',
          subagentType: 'backend-dev',
          status: 'active',
          phase: 'implementing',
          toolUseCount: 0,
          startedAt: '2026-04-15T10:00:00.000Z',
          lastActiveAt: '2026-04-15T10:00:00.000Z',
          transcriptPath: '/tmp/a.jsonl',
          recentToolUseTimestamps: [],
          tokensIn: 0,
          tokensOut: 0,
          cacheCreateTokens: 0,
          cacheReadTokens: 0,
          estCostUsd: 0,
          hostId: 'local',
        },
      } satisfies SSEMessage);
    });
    const agents = useMissionStore.getState().agents;
    expect(Object.keys(agents)).toHaveLength(1);
    expect(agents['agent-1'].id).toBe('agent-1');
  });

  it('sets sseStatus to "disconnected" and schedules reconnect on onerror', () => {
    renderHook(() => useSSE('/api/stream'));
    act(() => {
      instances[0]._simulateError();
    });
    expect(useMissionStore.getState().sseStatus).toBe('disconnected');
    // A reconnect timeout was scheduled — advance timers to trigger it
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    // Second EventSource should have been created
    expect(instances).toHaveLength(2);
  });

  it('appends ?since=lastSeq on reconnect when lastSeq > 0', () => {
    renderHook(() => useSSE('/api/stream'));

    // Simulate receiving a snapshot with lastSeq=42
    act(() => {
      instances[0]._simulateMessage({ type: 'snapshot', payload: makeSnapshot({ lastSeq: 42 }) } satisfies SSEMessage);
    });

    // Trigger an error → disconnect
    act(() => {
      instances[0]._simulateError();
    });

    // Advance past reconnect delay (1s base for first retry)
    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(instances).toHaveLength(2);
    expect(instances[1].url).toBe('/api/stream?since=42');
  });

  it('closes EventSource and clears timers on unmount (no leaks)', () => {
    const { unmount } = renderHook(() => useSSE('/api/stream'));

    // Trigger an error to schedule a reconnect timer
    act(() => {
      instances[0]._simulateError();
    });

    unmount();

    // After unmount, the timer should have been cleared — advancing time should NOT create a new instance
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    // close() was called on the original (before error closed it, but cleanup re-closes safely)
    // Key assertion: no new instances were created after unmount
    expect(instances).toHaveLength(1);
  });

  it('ignores malformed (non-JSON) messages without throwing', () => {
    renderHook(() => useSSE('/api/stream'));
    expect(() => {
      act(() => {
        // Directly fire onmessage with non-JSON data
        const event = new MessageEvent('message', { data: 'not-json{{' });
        if (instances[0].onmessage) instances[0].onmessage(event);
      });
    }).not.toThrow();
  });

  it('uses "reconnecting" status for subsequent reconnect attempts', () => {
    renderHook(() => useSSE('/api/stream'));

    // First error triggers reconnect attempt 1
    act(() => {
      instances[0]._simulateError();
    });
    expect(useMissionStore.getState().sseStatus).toBe('disconnected');

    // Advance past first delay and create second instance
    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(useMissionStore.getState().sseStatus).toBe('reconnecting');
  });
});
