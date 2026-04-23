import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/ingest/status
 *
 * Reports whether multi-host ingest is enabled (i.e. MC_INGEST_TOKENS is set)
 * and returns the first configured token so the settings UI can render a
 * ready-to-copy reporter command block.
 *
 * SECURITY: this endpoint returns a bearer token over an unauthenticated
 * same-origin GET. That is acceptable under Mission Control's default trust
 * model — the dashboard binds to localhost and assumes any dashboard user
 * already has full operator access. Do NOT expose MC on a public interface
 * without adding an auth layer in front; see README "Security Model".
 */
export function GET(): NextResponse<{ ingestEnabled: boolean; token: string | null }> {
  const raw = process.env.MC_INGEST_TOKENS ?? '';
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return NextResponse.json({
    ingestEnabled: tokens.length > 0,
    token: tokens[0] ?? null,
  });
}
