import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { inspectPath } from '@/server/workspace/inspect';
import type { InspectResponse } from '@/types/workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  path: z.string().min(1, 'path query param is required'),
});

type ErrorEnvelope = { error: string | { code: string; message: string } };

export async function GET(
  req: NextRequest
): Promise<NextResponse<InspectResponse | ErrorEnvelope>> {
  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({ path: searchParams.get('path') });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors.path?.[0] ?? 'Invalid query' },
      { status: 400 }
    );
  }

  try {
    const result = await inspectPath(parsed.data.path);
    return NextResponse.json(result);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'PATH_UNSAFE') {
      return NextResponse.json(
        { error: { code: 'PATH_UNSAFE', message: 'Invalid path' } },
        { status: 400 },
      );
    }
    console.error('[GET /api/workspace/inspect]', err);
    return NextResponse.json(
      { error: { code: 'INSPECT_ERROR', message: 'Workspace inspection failed' } },
      { status: 500 }
    );
  }
}
