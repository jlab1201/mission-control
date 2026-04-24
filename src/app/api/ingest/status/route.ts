import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface IngestStatusResponse {
  ingestEnabled: boolean;
  hasToken: boolean;
  tokenFingerprint: string | null;
  tokensCount: number;
}

/**
 * GET /api/ingest/status
 *
 * Reports whether multi-host ingest is enabled (i.e. MC_INGEST_TOKENS is set)
 * and returns a safe fingerprint (last 4 chars) of the primary token for
 * display / troubleshooting. The raw token is NOT returned here.
 *
 * To retrieve the full primary token use POST /api/ingest/token/reveal,
 * which is protected by the Origin-check middleware.
 */
export function GET(): NextResponse<IngestStatusResponse> {
  const raw = process.env.MC_INGEST_TOKENS ?? '';
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const primary = tokens[0] ?? null;
  const tokenFingerprint = primary !== null ? primary.slice(-4) : null;

  return NextResponse.json({
    ingestEnabled: tokens.length > 0,
    hasToken: tokens.length > 0,
    tokenFingerprint,
    tokensCount: tokens.length,
  });
}
