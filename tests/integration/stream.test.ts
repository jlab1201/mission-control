import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock watcher and dependencies BEFORE importing the route handler
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

import { GET } from '@/app/api/stream/route';
import { registry } from '@/server/watcher/registry';
import { eventBus } from '@/lib/eventBus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

/**
 * Reads all chunks from a ReadableStream into a string.
 * Aborts after `maxBytes` to avoid hanging on never-closing SSE streams.
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  maxBytes = 65_536,
): Promise<string> {
  const reader = body.getReader();
  const chunks: string[] = [];
  let totalBytes = 0;
  const decoder = new TextDecoder();

  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      chunks.push(text);
      totalBytes += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  return chunks.join('');
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset registry state between tests by creating a new one
  // (registry is a singleton; we work with it as-is but clear events)
  // We use the shared registry and rely on each test asserting on the response
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/stream', () => {
  describe('initial connection (no ?since param)', () => {
    it('responds with Content-Type: text/event-stream', async () => {
      const res = await GET(makeRequest('http://localhost:3000/api/stream'));
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    });

    it('responds with Cache-Control: no-cache', async () => {
      const res = await GET(makeRequest('http://localhost:3000/api/stream'));
      expect(res.headers.get('Cache-Control')).toContain('no-cache');
    });

    it('responds with status 200', async () => {
      const res = await GET(makeRequest('http://localhost:3000/api/stream'));
      expect(res.status).toBe(200);
    });

    it('sends a snapshot frame as the first SSE event', async () => {
      const res = await GET(makeRequest('http://localhost:3000/api/stream'));
      expect(res.body).not.toBeNull();

      // Cancel the stream after reading first chunk
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      reader.cancel();

      const text = new TextDecoder().decode(value);
      expect(text).toContain('"type":"snapshot"');
    });

    it('snapshot frame includes mission metadata', async () => {
      const res = await GET(makeRequest('http://localhost:3000/api/stream'));
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      reader.cancel();

      const text = new TextDecoder().decode(value);
      const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
      expect(dataLine).toBeTruthy();
      const parsed = JSON.parse(dataLine!.slice('data: '.length));
      expect(parsed.type).toBe('snapshot');
      expect(parsed.payload).toHaveProperty('agents');
      expect(parsed.payload).toHaveProperty('tasks');
      expect(parsed.payload).toHaveProperty('events');
    });
  });

  describe('?since=N replay branch', () => {
    it('replays events with seq > since when ?since is provided', async () => {
      // Seed registry with known events
      const e1 = registry.addEvent({
        id: `replay-ev-${Date.now()}-1`,
        agentId: 'agent-1',
        agentName: 'main',
        type: 'tool_use',
        summary: 'First replay event',
        timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      const e2 = registry.addEvent({
        id: `replay-ev-${Date.now()}-2`,
        agentId: 'agent-1',
        agentName: 'main',
        type: 'tool_use',
        summary: 'Second replay event',
        timestamp: '2026-04-15T10:00:01Z',
        hostId: 'local',
      });

      // Request with since = e1.seq (should replay e2 only)
      const res = await GET(
        makeRequest(`http://localhost:3000/api/stream?since=${e1.seq}`),
      );
      expect(res.body).not.toBeNull();

      const reader = res.body!.getReader();
      const { value } = await reader.read();
      reader.cancel();

      const text = new TextDecoder().decode(value);
      expect(text).toContain('"type":"event:new"');
      expect(text).toContain(e2.id);
      // e1 should NOT be replayed
      expect(text).not.toContain(e1.id);
    });

    it('replays all events when ?since=0', async () => {
      const uniqueId1 = `since0-ev-${Date.now()}-a`;
      const uniqueId2 = `since0-ev-${Date.now()}-b`;

      registry.addEvent({
        id: uniqueId1,
        agentId: 'agent-1',
        agentName: 'main',
        type: 'tool_use',
        summary: 'Event A',
        timestamp: '2026-04-15T10:00:00Z',
        hostId: 'local',
      });
      registry.addEvent({
        id: uniqueId2,
        agentId: 'agent-1',
        agentName: 'main',
        type: 'message',
        summary: 'Event B',
        timestamp: '2026-04-15T10:00:01Z',
        hostId: 'local',
      });

      // since=0 should replay both events
      const res = await GET(
        makeRequest('http://localhost:3000/api/stream?since=0'),
      );
      expect(res.body).not.toBeNull();

      // The route enqueues all replay events synchronously in the start() callback.
      // Each event is a separate enqueue() call so may come as separate chunks.
      // Read all available synchronous chunks then cancel.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];

      // Read chunks until we see both unique IDs or run out (the stream never
      // closes while open, so we stop when we have what we need)
      let text = '';
      while (!text.includes(uniqueId1) || !text.includes(uniqueId2)) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(decoder.decode(value));
          text = chunks.join('');
        }
      }
      reader.cancel();

      expect(text).toContain(uniqueId1);
      expect(text).toContain(uniqueId2);
    }, 10_000);

    it('sends no snapshot frame when ?since param is present', async () => {
      const res = await GET(
        makeRequest('http://localhost:3000/api/stream?since=0'),
      );
      const reader = res.body!.getReader();
      // Read up to first chunk
      const { value } = await reader.read();
      reader.cancel();

      const text = value ? new TextDecoder().decode(value) : '';
      // With since param, must NOT send a snapshot
      expect(text).not.toContain('"type":"snapshot"');
    });
  });

  describe('connection cap', () => {
    it('returns 503 when the connection cap is exceeded', async () => {
      // The cap is 10 (MAX_CONNECTIONS); make 10 connections and hold them open
      const controllers: ReadableStreamDefaultController[] = [];
      const held: Promise<Response>[] = [];

      // We can't easily hold open real SSE connections without actually reading them,
      // so we test the cap by monkey-patching activeConnections via repeated calls
      // and verifying the 503 path.
      // Instead: simply hit GET 11 times without reading bodies (connections "hold")
      // This is tricky because the stream route increments activeConnections in start().
      // We verify the behavior is documented — the route exports MAX_CONNECTIONS = 10.
      // A simpler assertion: 11th request returns 503.

      // NOTE: Due to JSDOM stream semantics, connections are "opened" synchronously
      // and the counter increments. We call GET 11 times.
      const responses: Response[] = [];
      for (let i = 0; i < 11; i++) {
        responses.push(await GET(makeRequest('http://localhost:3000/api/stream')));
      }

      // At least one response should be 503 (the 11th or later)
      const statuses = responses.map((r) => r.status);
      expect(statuses).toContain(503);

      // Cleanup: cancel all stream bodies to release the connection counter
      for (const r of responses) {
        if (r.body) {
          try {
            await r.body.cancel();
          } catch {
            // ignore
          }
        }
      }
    });
  });
});
