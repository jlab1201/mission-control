import type { RegisteredProject, RegisteredProjectRow } from '@/types/workspace';

export type { RegisteredProject, RegisteredProjectRow };

/**
 * POST /api/hosts/test
 * Checks whether a host is live (posted within the last 60 s).
 */
export async function testHost(
  hostId: string,
): Promise<{ ok: boolean; lastPostedAt?: string; reason?: string }> {
  const res = await fetch('/api/hosts/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostId }),
  });
  if (!res.ok) {
    let reason: string | undefined;
    try {
      const body = (await res.json()) as { reason?: string };
      reason = body.reason;
    } catch { /* ignore */ }
    return { ok: false, reason };
  }
  return (await res.json()) as { ok: boolean; lastPostedAt?: string; reason?: string };
}

/**
 * GET /api/projects
 * Returns all registered projects enriched with live host status.
 */
export async function listProjects(): Promise<{ projects: RegisteredProjectRow[] }> {
  const res = await fetch('/api/projects');
  if (!res.ok) return { projects: [] };
  return (await res.json()) as { projects: RegisteredProjectRow[] };
}

/**
 * POST /api/projects/test
 * Checks whether a project path is accessible on the given host.
 */
export async function testProject(
  hostId: string,
  path: string,
): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch('/api/projects/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostId, path }),
  });
  if (!res.ok) {
    let reason: string | undefined;
    try {
      const body = (await res.json()) as { reason?: string };
      reason = body.reason;
    } catch { /* ignore */ }
    return { ok: false, reason };
  }
  return (await res.json()) as { ok: boolean; reason?: string };
}

/**
 * POST /api/projects/register
 * Registers (or idempotently updates) a project.
 * Throws on non-2xx responses.
 */
export async function registerProject(
  name: string,
  hostId: string,
  path: string,
): Promise<{ project: RegisteredProject }> {
  const res = await fetch('/api/projects/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, hostId, path }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: unknown };
      detail = JSON.stringify(body.error);
    } catch { /* ignore */ }
    throw new Error(`registerProject failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as { project: RegisteredProject };
}

/**
 * DELETE /api/projects/[id]
 * Removes a registered project. Throws on unexpected errors (ignores 404).
 */
export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteProject failed (${res.status})`);
  }
}
