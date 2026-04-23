import { NextResponse } from 'next/server';
import { ensureWatcherStarted } from '@/server/watcher';
import { registry } from '@/server/watcher/registry';
import type { MissionStats, ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse<ApiResponse<MissionStats>>> {
  ensureWatcherStarted();
  return NextResponse.json({ data: registry.computeStats() });
}
