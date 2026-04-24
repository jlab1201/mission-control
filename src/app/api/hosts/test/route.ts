import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getHost } from '@/server/ingest/hostRegistry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

const BodySchema = z.object({
  hostId: z.string().regex(HOST_ID_REGEX, 'hostId must match /^[a-zA-Z0-9_-]{1,64}$/'),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── POST /api/hosts/test ───────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: { code: 'invalid-json', message: 'Request body must be valid JSON' } }, 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: { code: 'validation', message: 'Invalid request body', details: parsed.error.issues } }, 422);
  }

  const { hostId } = parsed.data;
  const host = getHost(hostId);

  if (!host) {
    return json({ ok: false, reason: 'not-found' });
  }

  if (!host.lastPostedAt) {
    return json({ ok: false, reason: 'never-posted' });
  }

  const ageMs = Date.now() - new Date(host.lastPostedAt).getTime();
  if (ageMs > 60_000) {
    return json({ ok: false, reason: 'stale' });
  }

  return json({ ok: true, lastPostedAt: host.lastPostedAt });
}
