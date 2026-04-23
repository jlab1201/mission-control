import { NextResponse } from 'next/server';
import { ensureWatcherStarted } from '@/server/watcher';
import { registry } from '@/server/watcher/registry';
import { toPublicAgent } from '@/types';
import type { PublicAgent, ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse<ApiResponse<PublicAgent[]>>> {
  ensureWatcherStarted();
  return NextResponse.json({ data: registry.getAgents().map(toPublicAgent) });
}
