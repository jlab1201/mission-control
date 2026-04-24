import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureWatcherStarted } from '@/server/watcher';
import { registry } from '@/server/watcher/registry';
import {
  getAllHosts,
  seedLocalHost,
  registerHost,
  hostStatus,
} from '@/server/ingest/hostRegistry';
import { localHostId } from '@/server/watcher/watcherCore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

const RegisterHostSchema = z
  .object({
    hostId: z.string().regex(HOST_ID_REGEX, 'hostId must match /^[a-zA-Z0-9_-]{1,64}$/'),
    hostLabel: z.string().max(64).optional(),
    hostname: z.string().max(253).optional(),
    ipAddress: z.string().max(45).optional(),
  })
  .strict();

const ERR_MESSAGES: Record<string, string> = {
  'invalid-json': 'Request body must be valid JSON',
  validation: 'Invalid request body',
};

function errJson(status: number, code: string, details?: unknown): Response {
  const message = ERR_MESSAGES[code] ?? code;
  return new Response(
    JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

// ── GET /api/hosts ─────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<Response> {
  ensureWatcherStarted();
  seedLocalHost();

  const localId = localHostId();
  const agents = registry.getAgents();
  const countsByHost = new Map<string, { total: number; active: number }>();
  for (const a of agents) {
    const c = countsByHost.get(a.hostId) ?? { total: 0, active: 0 };
    c.total++;
    if (a.status === 'active') c.active++;
    countsByHost.set(a.hostId, c);
  }

  const nowMs = Date.now();
  const hosts = getAllHosts()
    .map((h) => {
      const counts = countsByHost.get(h.hostId) ?? { total: 0, active: 0 };
      return {
        ...h,
        agentCount: counts.total,
        activeAgentCount: counts.active,
        status: hostStatus(h.hostId, nowMs) as 'live' | 'stale' | 'pending',
        isLocal: h.hostId === localId,
      };
    })
    .sort((a, b) => {
      // Local first
      if (a.isLocal && !b.isLocal) return -1;
      if (!a.isLocal && b.isLocal) return 1;
      // Then by lastPostedAt desc (undefined last)
      if (a.lastPostedAt && b.lastPostedAt) {
        return b.lastPostedAt.localeCompare(a.lastPostedAt);
      }
      if (a.lastPostedAt) return -1;
      if (b.lastPostedAt) return 1;
      // Then by registeredAt desc
      return b.registeredAt.localeCompare(a.registeredAt);
    });

  return new Response(JSON.stringify({ hosts }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── POST /api/hosts ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errJson(400, 'invalid-json');
  }

  const parsed = RegisterHostSchema.safeParse(raw);
  if (!parsed.success) return errJson(422, 'validation', parsed.error.issues);

  const host = registerHost(parsed.data);

  return new Response(JSON.stringify({ host }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
