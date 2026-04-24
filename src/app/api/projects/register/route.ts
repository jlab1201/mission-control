import { NextRequest } from 'next/server';
import { z } from 'zod';
import { addRegisteredProject } from '@/server/workspace/config';
import { isKnownHost } from '@/server/ingest/hostRegistry';
import { localHostId } from '@/server/watcher/watcherCore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

const BodySchema = z.object({
  name: z.string().transform((s) => s.trim()).refine((s) => s.length >= 1 && s.length <= 128, {
    message: 'name must be 1–128 characters after trimming',
  }),
  hostId: z
    .string()
    .refine((s) => s === 'local' || HOST_ID_REGEX.test(s), {
      message: 'hostId must be "local" or match /^[a-zA-Z0-9_-]{1,64}$/',
    }),
  path: z.string().min(1, 'path is required'),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── POST /api/projects/register ────────────────────────────────────────────────

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

  const { name, hostId, path } = parsed.data;
  const localId = localHostId();
  const isLocal = hostId === 'local' || hostId === localId;

  // For remote hosts, verify the host is known in the registry
  if (!isLocal && !isKnownHost(hostId)) {
    return json({ error: { code: 'HOST_UNKNOWN', message: 'Host not registered' } }, 400);
  }

  try {
    const project = await addRegisteredProject({ name, hostId, path });
    return json({ project }, 201);
  } catch (err) {
    console.error('[POST /api/projects/register]', err);
    return json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to register project' } }, 500);
  }
}
