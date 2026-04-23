import { NextResponse } from 'next/server';
import { readConfig } from '@/server/workspace/config';
import type { WorkspaceConfig } from '@/types/workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse<WorkspaceConfig | { error: string }>> {
  try {
    const config = await readConfig();
    return NextResponse.json(config);
  } catch (err) {
    console.error('[GET /api/workspace/config]', err);
    return NextResponse.json(
      { error: 'Failed to read workspace config' },
      { status: 500 }
    );
  }
}
