import { NextRequest } from 'next/server';
import { getHost, hostStatus } from '@/server/ingest/hostRegistry';
import { registry } from '@/server/watcher/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function errJson(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── GET /api/hosts/:hostId/status ──────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hostId: string }> },
): Promise<Response> {
  const { hostId } = await params;

  if (!HOST_ID_REGEX.test(hostId)) {
    return errJson(400, 'invalid-host-id');
  }

  const host = getHost(hostId);
  if (!host) {
    return errJson(404, 'not-known');
  }

  const nowMs = Date.now();
  const status = hostStatus(hostId, nowMs) as 'live' | 'stale' | 'pending';

  const agents = registry.getAgents().filter((a) => a.hostId === hostId);
  const agentCount = agents.length;
  const activeAgentCount = agents.filter((a) => a.status === 'active').length;

  const body = {
    hostId: host.hostId,
    status,
    ...(host.lastPostedAt !== undefined ? { lastPostedAt: host.lastPostedAt } : {}),
    registeredAt: host.registeredAt,
    agentCount,
    activeAgentCount,
    // watchedProjectPath intentionally omitted — internal fs path, not safe for public response
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
