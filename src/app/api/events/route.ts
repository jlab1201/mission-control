import { NextRequest, NextResponse } from 'next/server';
import { ensureWatcherStarted } from '@/server/watcher';
import { registry } from '@/server/watcher/registry';
import type { AgentEvent, ApiResponse } from '@/types';
import { MAX_EVENTS_PER_REQUEST, DEFAULT_EVENTS_LIMIT } from '@/lib/config/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<AgentEvent[]> | { error: { code: string; message: string; details?: unknown } }>> {
  ensureWatcherStarted();

  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const limitParam = searchParams.get('limit');

  const since = sinceParam !== null ? parseInt(sinceParam, 10) : 0;
  const limit = limitParam !== null ? Math.min(parseInt(limitParam, 10), MAX_EVENTS_PER_REQUEST) : DEFAULT_EVENTS_LIMIT;

  if (isNaN(since) || isNaN(limit)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' } },
      { status: 422 },
    );
  }

  const events = registry.eventsSince(since).slice(0, limit);
  return NextResponse.json({ data: events });
}
