import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { installTeamKit } from '@/server/workspace/install';
import type { InstallResponse } from '@/types/workspace';
import type { ApiErrorResponse } from '@/types/index';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  path: z.string().min(1, 'path is required').max(4096),
  force: z.boolean().optional(),
  createIfMissing: z.boolean().optional(),
});

export async function POST(
  req: NextRequest
): Promise<NextResponse<InstallResponse | ApiErrorResponse>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.flatten().fieldErrors } },
      { status: 422 },
    );
  }

  try {
    const result = await installTeamKit(parsed.data);
    if (result.status === 'error') {
      // PATH_UNSAFE is a bad client-supplied value → 400; all other errors → 500
      const isPathUnsafe = result.message.startsWith('PATH_UNSAFE');
      console.error('[POST /api/workspace/install] install error:', result.message);
      return NextResponse.json(
        { error: { code: isPathUnsafe ? 'PATH_UNSAFE' : 'INSTALL_ERROR', message: isPathUnsafe ? 'Invalid path' : 'Install failed' } },
        { status: isPathUnsafe ? 400 : 500 },
      );
    }
    return NextResponse.json(result, { status: result.status === 'skipped' ? 200 : 201 });
  } catch (err) {
    console.error('[POST /api/workspace/install]', err);
    return NextResponse.json(
      { error: { code: 'INSTALL_ERROR', message: 'Install failed' } },
      { status: 500 }
    );
  }
}
