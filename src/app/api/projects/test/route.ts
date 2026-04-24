import { NextRequest } from 'next/server';
import { z } from 'zod';
import { access, stat, constants } from 'fs/promises';
import { getHost, hostStatus } from '@/server/ingest/hostRegistry';
import { localHostId } from '@/server/watcher/watcherCore';
import { assertPathInHome } from '@/server/workspace/pathGuard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

const BodySchema = z.object({
  hostId: z.string().min(1),
  path: z.string().min(1),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── POST /api/projects/test ────────────────────────────────────────────────────

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

  const { hostId, path: targetPath } = parsed.data;
  const localId = localHostId();
  const isLocal = hostId === 'local' || hostId === localId;

  if (isLocal) {
    // Guard against path-traversal / arbitrary filesystem probing
    try {
      assertPathInHome(targetPath);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'PATH_UNSAFE') {
        return json({ ok: false, reason: 'path-unsafe' });
      }
      throw e;
    }

    // Check: exists, is a directory, is readable
    try {
      const s = await stat(targetPath);
      if (!s.isDirectory()) {
        return json({ ok: false, reason: 'not-directory' });
      }
    } catch {
      return json({ ok: false, reason: 'missing' });
    }

    try {
      await access(targetPath, constants.R_OK);
    } catch {
      return json({ ok: false, reason: 'not-readable' });
    }

    return json({ ok: true });
  }

  // Remote host — validate hostId format first
  if (!HOST_ID_REGEX.test(hostId)) {
    return json({ error: { code: 'validation', message: 'Invalid hostId format' } }, 422);
  }

  const host = getHost(hostId);
  if (!host) {
    return json({ ok: false, reason: 'host-not-found' });
  }

  const status = hostStatus(hostId, Date.now());
  if (status === 'stale' || status === 'unknown') {
    return json({ ok: false, reason: 'host-stale' });
  }

  return json({ ok: true });
}
