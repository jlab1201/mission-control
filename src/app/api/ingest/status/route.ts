import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/ingest/status
 *
 * Reports whether multi-host ingest is enabled (i.e. MC_INGEST_TOKENS is set).
 * Used by the settings UI to warn operators before they follow reporter setup
 * instructions that would otherwise fail with 401.
 */
export function GET(): NextResponse<{ ingestEnabled: boolean }> {
  const raw = process.env.MC_INGEST_TOKENS ?? '';
  const hasTokens = raw
    .split(',')
    .map((t) => t.trim())
    .some((t) => t.length > 0);
  return NextResponse.json({ ingestEnabled: hasTokens });
}
