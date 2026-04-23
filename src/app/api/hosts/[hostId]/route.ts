import { NextRequest } from 'next/server';
import { forgetHost, isKnownHost } from '@/server/ingest/hostRegistry';

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

  if (!isKnownHost(hostId)) {
    return errJson(404, 'not-found');
  }

  const removed = forgetHost(hostId);
  if (!removed) {
    // forgetHost returns false only for local host
    return errJson(409, 'cannot-forget-local');
  }

  return new Response(null, { status: 204 });
}
