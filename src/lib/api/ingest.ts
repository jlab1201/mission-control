import type { IngestStatusResponse } from '@/app/api/ingest/status/route';

export type { IngestStatusResponse };

/**
 * Fetch ingest configuration status (no raw token returned).
 */
export async function getIngestStatus(): Promise<IngestStatusResponse> {
  const res = await fetch('/api/ingest/status');
  if (!res.ok) throw new Error('Failed to fetch ingest status');
  return res.json() as Promise<IngestStatusResponse>;
}

/**
 * Retrieve the primary ingest token via the CSRF-protected reveal endpoint.
 * Must be called from same-origin context (browser on the dashboard).
 */
export async function revealIngestToken(): Promise<string | null> {
  const res = await fetch('/api/ingest/token/reveal', { method: 'POST' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to reveal ingest token');
  const data = (await res.json()) as { token: string };
  return data.token;
}
