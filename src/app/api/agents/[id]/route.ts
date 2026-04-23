import { NextRequest, NextResponse } from 'next/server';
import { ensureWatcherStarted } from '@/server/watcher';
import { registry } from '@/server/watcher/registry';
import { toPublicAgent } from '@/types';
import type { PublicAgent, ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<PublicAgent> | { error: { code: string; message: string } }>> {
  ensureWatcherStarted();

  const { id } = await params;

  if (!id || id.length > 50 || !/^[a-z0-9_-]+$/i.test(id)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid agent id' } },
      { status: 400 },
    );
  }

  const agent = registry.getAgent(id);
  if (!agent) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Agent not found' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: toPublicAgent(agent) });
}
