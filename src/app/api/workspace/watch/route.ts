import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readConfig, writeConfig, prependRecentPath } from '@/server/workspace/config';
import { restartWatcher } from '@/server/watcher';
import { assertPathInHome } from '@/server/workspace/pathGuard';
import type { WorkspaceConfig } from '@/types/workspace';
import type { ApiResponse, ApiError } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  path: z.string().min(1, 'path is required').max(4096),
});

export async function POST(
  req: NextRequest
): Promise<NextResponse<ApiResponse<WorkspaceConfig> | ApiError>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Validation error', details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  // M3: guard against path traversal before any fs op or config write
  let safePath: string;
  try {
    safePath = assertPathInHome(parsed.data.path);
  } catch {
    return NextResponse.json(
      { error: { code: 'PATH_UNSAFE', message: 'Invalid path' } },
      { status: 400 }
    );
  }

  try {
    const current = await readConfig();
    const updated: WorkspaceConfig = {
      watchPath: safePath,
      recentPaths: prependRecentPath(current.recentPaths, safePath),
      registeredProjects: current.registeredProjects,
    };
    await writeConfig(updated);

    // Restart the live watcher so it picks up the new path immediately.
    restartWatcher();

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error('[POST /api/workspace/watch]', err);
    return NextResponse.json(
      { error: { code: 'WATCH_UPDATE_FAILED', message: 'Watch update failed' } },
      { status: 500 }
    );
  }
}
