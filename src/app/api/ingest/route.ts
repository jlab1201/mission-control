import { NextRequest } from 'next/server';
import { verifyBearer } from '@/server/ingest/auth';
import { acquire } from '@/server/ingest/rateLimit';
import { IngestPayloadSchema } from '@/server/ingest/schema';
import { applyIngest } from '@/server/ingest/ingestHandler';
import { consumeDisconnectSignal } from '@/server/ingest/hostRegistry';
import { MAX_INGEST_BODY_BYTES } from '@/lib/config/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function errJson(status: number, code: string, details?: unknown): Response {
  return new Response(
    JSON.stringify({ error: { code, message: code, ...(details ? { details } : {}) } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  // Size-guard BEFORE parsing — do not call request.json()
  const reader = request.body?.getReader();
  if (!reader) return errJson(400, 'empty-body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INGEST_BODY_BYTES) {
        await reader.cancel();
        return errJson(413, 'body-too-large');
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  // Auth — runs before Zod so unauthenticated callers don't burn CPU on
  // up-to-5MB schema validation. Auth check is constant-time + memoized.
  const auth = verifyBearer(request);
  if (!auth.ok) {
    if (auth.reason === 'disabled') return errJson(503, 'ingest-disabled');
    return errJson(401, 'unauthorized');
  }

  // Rate limit
  if (!acquire(auth.tokenDigest)) return errJson(429, 'rate-limited');

  // Parse
  const text = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf-8');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return errJson(400, 'invalid-json'); }

  // Validate
  const parsed = IngestPayloadSchema.safeParse(raw);
  if (!parsed.success) return errJson(400, 'validation', parsed.error.issues);

  // Disconnect signal — single-use; tells a recently-deleted host's reporter to exit
  if (consumeDisconnectSignal(parsed.data.hostId)) {
    return errJson(410, 'host-disconnected');
  }

  // Apply — wrapped internally in registry.applyBatch
  const result = applyIngest(
    parsed.data.hostId,
    parsed.data.hostLabel,
    parsed.data.watchedProjectPath,
    parsed.data,
  );

  return new Response(JSON.stringify({ accepted: true, ...result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
