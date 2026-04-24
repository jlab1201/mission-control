// Dashboard API client for /api/hosts/*. Same-origin, no auth needed —
// only /api/ingest (external reporters) is bearer-gated.

export interface KnownHost {
  hostId: string;
  hostLabel?: string;
  hostname?: string;
  ipAddress?: string;
  watchedProjectPath?: string;
  registeredAt: string;
  lastPostedAt?: string;
  manuallyAdded: boolean;
  status: 'live' | 'stale' | 'pending';
  agentCount: number;
  activeAgentCount: number;
  isLocal: boolean;
}

export interface HostStatus {
  hostId: string;
  status: 'live' | 'stale' | 'pending';
  lastPostedAt?: string;
  registeredAt: string;
  agentCount: number;
  activeAgentCount: number;
  watchedProjectPath?: string;
}

async function expectOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      detail = body.error?.code ?? body.error?.message ?? '';
    } catch {
      detail = res.statusText;
    }
    throw new Error(`${context}: ${res.status}${detail ? ` — ${detail}` : ''}`);
  }
}

export async function listHosts(): Promise<KnownHost[]> {
  const res = await fetch('/api/hosts');
  await expectOk(res, 'listHosts');
  const body = (await res.json()) as { hosts: KnownHost[] };
  return body.hosts;
}

export async function registerHost(input: {
  hostId: string;
  hostLabel?: string;
  hostname?: string;
  ipAddress?: string;
}): Promise<KnownHost> {
  const res = await fetch('/api/hosts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  await expectOk(res, 'registerHost');
  const body = (await res.json()) as { host: KnownHost };
  return body.host;
}

export async function disconnectHost(hostId: string): Promise<{ projectsRemoved: number }> {
  const res = await fetch(`/api/hosts/${encodeURIComponent(hostId)}`, {
    method: 'DELETE',
  });
  // 404 = host already gone (e.g. server restarted since the UI loaded).
  // Treat as a no-op success so the UI can refresh instead of erroring.
  if (res.status === 404) return { projectsRemoved: 0 };
  await expectOk(res, 'disconnectHost');
  const body = (await res.json()) as { ok: boolean; projectsRemoved: number };
  return { projectsRemoved: body.projectsRemoved };
}

export async function testHost(hostId: string): Promise<HostStatus> {
  const res = await fetch(`/api/hosts/${encodeURIComponent(hostId)}/status`);
  await expectOk(res, 'testHost');
  return (await res.json()) as HostStatus;
}
