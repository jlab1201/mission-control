import { NextRequest } from 'next/server';
import { listRegisteredProjects } from '@/server/workspace/config';
import { getHost, hostStatus } from '@/server/ingest/hostRegistry';
import { localHostId } from '@/server/watcher/watcherCore';
import type { RegisteredProjectRow } from '@/types/workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── GET /api/projects ──────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<Response> {
  try {
    const stored = await listRegisteredProjects();
    const localId = localHostId();
    const nowMs = Date.now();

    const projects: RegisteredProjectRow[] = stored.map((p) => {
      const isLocal = p.hostId === 'local' || p.hostId === localId;

      if (isLocal) {
        const localHost = getHost('local') ?? getHost(localId);
        return {
          ...p,
          hostStatus: 'live',
          hostLabel: localHost?.hostLabel,
          isLocal: true,
        };
      }

      const host = getHost(p.hostId);
      const status = hostStatus(p.hostId, nowMs);

      return {
        ...p,
        hostStatus: status,
        hostLabel: host?.hostLabel,
        isLocal: false,
      };
    });

    return new Response(JSON.stringify({ projects }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET /api/projects]', err);
    return new Response(
      JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list projects' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
