import { NextRequest } from 'next/server';
import pino from 'pino';
import { ensureWatcherStarted } from '@/server/watcher';
import { registry } from '@/server/watcher/registry';
import { eventBus } from '@/lib/eventBus';
import { toPublicSSEMessage } from '@/types';
import type { SSEMessage, PublicSSEMessage } from '@/types';
import { MAX_SSE_CONNECTIONS, SSE_HEARTBEAT_MS, MAX_REPLAY_EVENTS } from '@/lib/config/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const logger = pino({ name: 'stream-route' });

// --- Concurrent-connection cap (M2) ---
const MAX_CONNECTIONS = MAX_SSE_CONNECTIONS;
let activeConnections = 0;

function formatSSE(message: PublicSSEMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

function safeEnqueueMsg(msg: SSEMessage): PublicSSEMessage {
  return toPublicSSEMessage(msg);
}

export async function GET(req: NextRequest): Promise<Response> {
  // Enforce connection cap before doing any work
  if (activeConnections >= MAX_CONNECTIONS) {
    return new Response('Too many connections', { status: 503 });
  }
  activeConnections++;

  ensureWatcherStarted();

  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const since = sinceParam !== null ? parseInt(sinceParam, 10) : NaN;

  // Idempotent cleanup — guards against both cancel() and abort racing
  let cleaned = false;
  let cleanup: (() => void) | null = null;

  const doCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    activeConnections--;
    if (cleanup) cleanup();
  };

  // Wire abort-signal so abrupt disconnects (network drops, proxy timeouts)
  // also release the eventBus listener and ping interval.
  req.signal.addEventListener('abort', doCleanup);

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

      // M12: distinguish a closed-stream TypeError from unexpected errors.
      const enqueue = (msg: SSEMessage) => {
        try {
          controller.enqueue(enc.encode(formatSSE(safeEnqueueMsg(msg))));
        } catch (err) {
          // Stream is already closed — silent return (expected on disconnect)
          if (
            err instanceof TypeError ||
            controller.desiredSize === null
          ) {
            return;
          }
          // Unexpected enqueue error — log at warn, do not re-throw
          logger.warn({ err }, 'Unexpected SSE enqueue error');
        }
      };

      // First frame: either replay missed events or full snapshot
      if (!isNaN(since)) {
        // M2: clamp replay to last MAX_REPLAY_EVENTS to prevent large catch-ups
        let missed = registry.eventsSince(since);
        if (missed.length > MAX_REPLAY_EVENTS) {
          missed = missed.slice(-MAX_REPLAY_EVENTS);
        }
        for (const ev of missed) {
          enqueue({ type: 'event:new', seq: ev.seq, payload: ev });
        }
      } else {
        enqueue({ type: 'snapshot', payload: registry.snapshot() });
      }

      // Subscribe to live events
      const onMessage = (message: SSEMessage) => enqueue(message);
      eventBus.on('message', onMessage);

      // Keepalive ping every 15s
      const pingInterval = setInterval(() => {
        enqueue({ type: 'ping' });
      }, SSE_HEARTBEAT_MS);

      cleanup = () => {
        eventBus.off('message', onMessage);
        clearInterval(pingInterval);
      };
    },

    cancel() {
      doCleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
