import { NextRequest } from 'next/server';
import { removeRegisteredProject } from '@/server/workspace/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── DELETE /api/projects/[id] ──────────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  try {
    const removed = await removeRegisteredProject(id);
    if (!removed) {
      return json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /api/projects/:id]', err);
    return json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete project' } }, 500);
  }
}
