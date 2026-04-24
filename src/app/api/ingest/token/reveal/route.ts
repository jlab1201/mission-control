import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface IngestTokenRevealResponse {
  token: string;
}

/**
 * POST /api/ingest/token/reveal
 *
 * Returns the primary ingest bearer token in cleartext.
 * This route is protected by the Origin-check middleware (applied to all
 * non-GET /api/* routes except /api/ingest itself) — callers must be
 * same-origin so cross-origin scripts cannot trigger this endpoint.
 *
 * No request body is required.
 */
export function POST(): NextResponse<IngestTokenRevealResponse | { error: { code: string; message: string } }> {
  const raw = process.env.MC_INGEST_TOKENS ?? '';
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const primary = tokens[0];

  if (!primary) {
    return NextResponse.json(
      { error: { code: 'NOT_CONFIGURED', message: 'No ingest token is configured' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ token: primary });
}
