import { NextRequest } from 'next/server';
import { forgetHost, isKnownHost, markHostDisconnected } from '@/server/ingest/hostRegistry';
import { listRegisteredProjects, removeRegisteredProject } from '@/server/workspace/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function errJson(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── DELETE /api/hosts/:hostId ──────────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ hostId: string }> },
): Promise<Response> {
  const { hostId } = await params;

  if (!HOST_ID_REGEX.test(hostId)) {
    return errJson(400, 'invalid-host-id');
  }

  if (hostId === 'local') {
    return errJson(400, 'cannot-disconnect-local');
  }

  if (!isKnownHost(hostId)) {
    return errJson(404, 'not-found');
  }

  // Remove all registered projects for this host
  const projects = await listRegisteredProjects();
  const matching = projects.filter((p) => p.hostId === hostId);
  for (const p of matching) {
    await removeRegisteredProject(p.id);
  }

  // Signal the host's reporter to exit on next ingest
  markHostDisconnected(hostId);

  // Remove from registry
  forgetHost(hostId);

  return new Response(
    JSON.stringify({ ok: true, projectsRemoved: matching.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
