import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock watcher dependencies BEFORE importing route/registry
// ---------------------------------------------------------------------------

vi.mock('@/server/watcher', () => ({
  ensureWatcherStarted: vi.fn(),
  restartWatcher: vi.fn(),
}));

vi.mock('pino', () => ({
  default: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { POST } from '@/app/api/ingest/route';
import { GET as GET_HOSTS } from '@/app/api/hosts/route';
import { registry } from '@/server/watcher/registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL('http://localhost/api/ingest'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeValidBody(overrides: Record<string, unknown> = {}) {
  return {
    hostId: 'test-host',
    mode: 'snapshot' as const,
    payload: {
      agents: [],
      events: [],
    },
    ...overrides,
  };
}

function makeAgent(id: string, hostId = 'test-host') {
  return {
    id,
    type: 'subagent' as const,
    name: `agent-${id}`,
    subagentType: 'backend-dev',
    status: 'active' as const,
    phase: 'implementing',
    toolUseCount: 0,
    startedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    transcriptPath: `/tmp/${id}.jsonl`,
    recentToolUseTimestamps: [],
    tokensIn: 0,
    tokensOut: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    estCostUsd: 0,
    hostId,
  };
}

function makeEvent(id: string, agentId: string, hostId = 'test-host') {
  return {
    id,
    agentId,
    agentName: `agent-${agentId}`,
    type: 'tool_use' as const,
    summary: `Event ${id}`,
    timestamp: new Date().toISOString(),
    hostId,
  };
}

const VALID_TOKEN = 'test-secret-token-32chars-longval';
const AUTH_HEADER = `Bearer ${VALID_TOKEN}`;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv('MC_INGEST_TOKENS', VALID_TOKEN);
  // Clear any registry state between tests
  if (typeof (registry as any).clear === 'function') {
    (registry as any).clear();
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/ingest', () => {
  // 1. 503 when disabled
  describe('disabled state', () => {
    it('returns 503 with ingest-disabled error when MC_INGEST_TOKENS is empty', async () => {
      vi.stubEnv('MC_INGEST_TOKENS', '');

      const req = makeRequest(makeValidBody(), { Authorization: AUTH_HEADER });
      const res = await POST(req);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe('ingest-disabled');
    });

    it('returns 503 when MC_INGEST_TOKENS is unset', async () => {
      vi.stubEnv('MC_INGEST_TOKENS', '');

      const req = makeRequest(makeValidBody());
      const res = await POST(req);

      expect(res.status).toBe(503);
    });
  });

  // 2. 401 missing auth
  describe('authentication', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const req = makeRequest(makeValidBody());
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    // 3. 401 wrong token
    it('returns 401 with wrong bearer token', async () => {
      const req = makeRequest(makeValidBody(), {
        Authorization: 'Bearer wrong-token-value',
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it('returns 401 with malformed Authorization header (no Bearer prefix)', async () => {
      const req = makeRequest(makeValidBody(), {
        Authorization: VALID_TOKEN,
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
    });
  });

  // 4. 400 validation
  describe('validation', () => {
    it('returns 400 when hostId contains spaces (fails regex)', async () => {
      const req = makeRequest(
        makeValidBody({ hostId: 'host with spaces' }),
        { Authorization: AUTH_HEADER },
      );
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it('returns 400 when mode is missing', async () => {
      const req = makeRequest(
        { hostId: 'valid-host', payload: { agents: [] } },
        { Authorization: AUTH_HEADER },
      );
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('returns 400 when payload is missing', async () => {
      const req = makeRequest(
        { hostId: 'valid-host', mode: 'snapshot' },
        { Authorization: AUTH_HEADER },
      );
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('returns 400 when hostId is too long (>64 chars)', async () => {
      const req = makeRequest(
        makeValidBody({ hostId: 'a'.repeat(65) }),
        { Authorization: AUTH_HEADER },
      );
      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  // 5. 413 oversize body
  describe('body size limit', () => {
    // SKIP: MAX_INGEST_BODY_BYTES is evaluated at module load via numEnv()
    // (default 5 MB). vi.stubEnv() cannot change it after import. A genuine
    // >5 MB payload would be slow in unit tests and is better covered by a
    // dedicated load/integration test. See src/lib/config/runtime.ts.
    it.skip('returns 413 when body exceeds MC_MAX_INGEST_BODY_BYTES', async () => {
      const largeBody = makeValidBody({
        hostLabel: 'a'.repeat(200),
      });

      const req = new NextRequest(new URL('http://localhost/api/ingest'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify(largeBody),
      });
      const res = await POST(req);

      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error.code).toBe('body-too-large');
    });
  });

  // 6. 200 happy path — snapshot
  describe('happy path — snapshot', () => {
    it('returns 200 and accepted:true with 2 agents', async () => {
      const agents = [makeAgent('agent-snap-1'), makeAgent('agent-snap-2')];
      const req = makeRequest(
        makeValidBody({ hostId: 'alpha', mode: 'snapshot', payload: { agents } }),
        { Authorization: AUTH_HEADER },
      );
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accepted).toBe(true);
    });

    it('stamps server-side hostId on ingested agents (snapshot mode)', async () => {
      const agents = [makeAgent('agent-snap-3'), makeAgent('agent-snap-4')];
      const req = makeRequest(
        makeValidBody({ hostId: 'alpha', mode: 'snapshot', payload: { agents } }),
        { Authorization: AUTH_HEADER },
      );
      await POST(req);

      const allAgents = registry.getAgents();
      const ingestedAgents = allAgents.filter((a) =>
        ['agent-snap-3', 'agent-snap-4'].includes(a.id),
      );
      expect(ingestedAgents).toHaveLength(2);
      ingestedAgents.forEach((a) => {
        expect(a.hostId).toBe('alpha');
      });
    });

    it('response includes ingestedAgents count', async () => {
      const agents = [makeAgent('agent-count-1'), makeAgent('agent-count-2')];
      const req = makeRequest(
        makeValidBody({ hostId: 'counter-host', mode: 'snapshot', payload: { agents } }),
        { Authorization: AUTH_HEADER },
      );
      const res = await POST(req);
      const body = await res.json();

      expect(body.ingestedAgents).toBe(2);
    });
  });

  // 7. 200 happy path — delta upsert
  describe('happy path — delta', () => {
    it('returns 200 and event appears in registry.eventsSince(0)', async () => {
      // First snapshot
      const agents = [makeAgent('delta-agent-1')];
      await POST(
        makeRequest(
          makeValidBody({ hostId: 'delta-host', mode: 'snapshot', payload: { agents } }),
          { Authorization: AUTH_HEADER },
        ),
      );

      // Delta with 1 event
      const event = makeEvent('delta-ev-1', 'delta-agent-1', 'delta-host');
      const deltaReq = makeRequest(
        {
          hostId: 'delta-host',
          mode: 'delta',
          payload: {
            agents: [{ ...makeAgent('delta-agent-1'), status: 'completed' }],
            events: [event],
          },
        },
        { Authorization: AUTH_HEADER },
      );
      const res = await POST(deltaReq);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accepted).toBe(true);

      const events = registry.eventsSince(0);
      expect(events.some((e) => e.id === 'delta-ev-1')).toBe(true);
    });
  });

  // 8. 200 happy path — removedAgentIds
  describe('happy path — removedAgentIds', () => {
    it('evicts agents listed in removedAgentIds', async () => {
      // Setup: snapshot with 2 agents
      const agents = [makeAgent('remove-agent-1'), makeAgent('remove-agent-2')];
      await POST(
        makeRequest(
          makeValidBody({
            hostId: 'remove-host',
            mode: 'snapshot',
            payload: { agents },
          }),
          { Authorization: AUTH_HEADER },
        ),
      );

      // Delta: remove agent-1
      const deltaReq = makeRequest(
        {
          hostId: 'remove-host',
          mode: 'delta',
          payload: {
            removedAgentIds: ['remove-agent-1'],
          },
        },
        { Authorization: AUTH_HEADER },
      );
      const res = await POST(deltaReq);

      expect(res.status).toBe(200);
      const allAgents = registry.getAgents();
      expect(allAgents.find((a) => a.id === 'remove-agent-1')).toBeUndefined();
      expect(allAgents.find((a) => a.id === 'remove-agent-2')).toBeDefined();
    });
  });

  // 9. Server-side hostId stamping
  describe('hostId stamping', () => {
    it('stamps all agents with the top-level hostId, overriding per-agent hostId', async () => {
      const agents = [
        makeAgent('stamp-agent-1', 'evil'),
        makeAgent('stamp-agent-2', 'evil'),
      ];
      const req = makeRequest(
        makeValidBody({
          hostId: 'alpha',
          mode: 'snapshot',
          payload: { agents },
        }),
        { Authorization: AUTH_HEADER },
      );
      await POST(req);

      const allAgents = registry.getAgents();
      const stamped = allAgents.filter((a) =>
        ['stamp-agent-1', 'stamp-agent-2'].includes(a.id),
      );
      expect(stamped).toHaveLength(2);
      stamped.forEach((a) => {
        expect(a.hostId).toBe('alpha');
        expect(a.hostId).not.toBe('evil');
      });
    });
  });

  // 10. Two hosts coexist
  describe('multi-host coexistence', () => {
    it('two hosts land separately; GET /api/hosts returns both with correct counts', async () => {
      // Host A: 3 agents
      const agentsA = [
        makeAgent('coexist-a1', 'hostA'),
        makeAgent('coexist-a2', 'hostA'),
        makeAgent('coexist-a3', 'hostA'),
      ];
      await POST(
        makeRequest(
          makeValidBody({
            hostId: 'hostA',
            mode: 'snapshot',
            payload: { agents: agentsA },
          }),
          { Authorization: AUTH_HEADER },
        ),
      );

      // Host B: 2 agents
      const agentsB = [
        makeAgent('coexist-b1', 'hostB'),
        makeAgent('coexist-b2', 'hostB'),
      ];
      await POST(
        makeRequest(
          makeValidBody({
            hostId: 'hostB',
            mode: 'snapshot',
            payload: { agents: agentsB },
          }),
          { Authorization: AUTH_HEADER },
        ),
      );

      // Registry should have at least 5 agents from the two hosts
      const allAgents = registry.getAgents();
      const hostAAgents = allAgents.filter((a) => a.hostId === 'hostA');
      const hostBAgents = allAgents.filter((a) => a.hostId === 'hostB');
      expect(hostAAgents).toHaveLength(3);
      expect(hostBAgents).toHaveLength(2);

      // GET /api/hosts should return both hosts
      const hostsRes = await GET_HOSTS(
        new NextRequest(new URL('http://localhost/api/hosts'), {
          headers: { Authorization: AUTH_HEADER },
        }),
      );
      expect(hostsRes.status).toBe(200);
      const hostsBody = await hostsRes.json();
      const hostIds = hostsBody.hosts.map((h: { hostId: string }) => h.hostId);
      expect(hostIds).toContain('hostA');
      expect(hostIds).toContain('hostB');

      const hostAEntry = hostsBody.hosts.find(
        (h: { hostId: string }) => h.hostId === 'hostA',
      );
      const hostBEntry = hostsBody.hosts.find(
        (h: { hostId: string }) => h.hostId === 'hostB',
      );
      expect(hostAEntry?.agentCount).toBe(3);
      expect(hostBEntry?.agentCount).toBe(2);
    });
  });

  // 11. 429 rate limit
  describe('rate limiting', () => {
    it('returns 429 after burst is exhausted', async () => {
      // INGEST_RATE_BURST is evaluated at module load (default 100).
      // We cannot override it at runtime with vi.stubEnv — the constant is
      // already frozen. Send BURST+1 = 101 requests in a tight loop; at least
      // one must be rate-limited.
      const responses: Response[] = [];
      for (let i = 0; i < 101; i++) {
        const req = makeRequest(
          makeValidBody({ hostId: `rate-host-${i}` }),
          { Authorization: AUTH_HEADER },
        );
        responses.push(await POST(req));
      }

      const statuses = responses.map((r) => r.status);
      expect(statuses).toContain(429);

      const tooManyIdx = statuses.findIndex((s) => s === 429);
      expect(tooManyIdx).toBeGreaterThanOrEqual(0);
    });
  });
});
