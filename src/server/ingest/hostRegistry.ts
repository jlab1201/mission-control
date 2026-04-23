import { localHostId } from '@/server/watcher/watcherCore';
import type { HostInfo } from '@/types';

export type { HostInfo };

const registry = new Map<string, HostInfo>();

// ── Derived status ────────────────────────────────────────────────────────────

export function hostStatus(
  hostId: string,
  nowMs: number = Date.now(),
): 'live' | 'stale' | 'pending' | 'unknown' {
  const host = registry.get(hostId);
  if (!host) return 'unknown';
  if (!host.lastPostedAt) return 'pending';
  const ageMs = nowMs - new Date(host.lastPostedAt).getTime();
  return ageMs <= 60_000 ? 'live' : 'stale';
}

// ── Mutators ──────────────────────────────────────────────────────────────────

/**
 * Called from ingest — auto-discovery path.
 * Updates lastPostedAt, sets registeredAt if new, overwrites watchedProjectPath
 * if provided. Does NOT clobber manuallyAdded: true.
 */
export function touchHost(
  hostId: string,
  hostLabel: string | undefined,
  meta?: { watchedProjectPath?: string },
): void {
  const now = new Date().toISOString();
  const existing = registry.get(hostId);
  if (existing) {
    existing.lastPostedAt = now;
    if (hostLabel && hostLabel.trim() !== '') {
      existing.hostLabel = hostLabel;
    }
    if (meta?.watchedProjectPath) {
      existing.watchedProjectPath = meta.watchedProjectPath;
    }
    // Never demote a manually-added host
    // (leave existing.manuallyAdded as-is)
  } else {
    registry.set(hostId, {
      hostId,
      hostLabel: hostLabel && hostLabel.trim() !== '' ? hostLabel : undefined,
      watchedProjectPath: meta?.watchedProjectPath,
      registeredAt: now,
      lastPostedAt: now,
      manuallyAdded: false,
    });
  }
}

/**
 * Called from POST /api/hosts — manual registration.
 * Sets manuallyAdded: true. Preserves lastPostedAt if host already exists.
 * Promotes auto-discovered hosts to manually added.
 */
export function registerHost(input: {
  hostId: string;
  hostLabel?: string;
  hostname?: string;
  ipAddress?: string;
}): HostInfo {
  const now = new Date().toISOString();
  const existing = registry.get(input.hostId);
  const entry: HostInfo = {
    hostId: input.hostId,
    hostLabel: input.hostLabel ?? existing?.hostLabel,
    hostname: input.hostname ?? existing?.hostname,
    ipAddress: input.ipAddress ?? existing?.ipAddress,
    watchedProjectPath: existing?.watchedProjectPath,
    registeredAt: existing?.registeredAt ?? now,
    lastPostedAt: existing?.lastPostedAt,
    manuallyAdded: true,
  };
  registry.set(input.hostId, entry);
  return entry;
}

/**
 * Removes a host from the registry.
 * Returns false (no-op) if the hostId is the local host or not found.
 */
export function forgetHost(hostId: string): boolean {
  if (hostId === localHostId()) return false;
  if (!registry.has(hostId)) return false;
  registry.delete(hostId);
  return true;
}

// ── Readers ───────────────────────────────────────────────────────────────────

export function getHost(hostId: string): HostInfo | undefined {
  return registry.get(hostId);
}

export function getAllHosts(): HostInfo[] {
  return Array.from(registry.values());
}

export function isKnownHost(hostId: string): boolean {
  return registry.has(hostId);
}

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

export function seedLocalHost(): void {
  const hostId = process.env.MC_HOST_ID || 'local';
  const hostLabel = process.env.MC_HOST_LABEL || undefined;
  // Only seed if not already registered — avoids clobbering richer hydrated data
  if (!registry.has(hostId)) {
    const now = new Date().toISOString();
    registry.set(hostId, {
      hostId,
      hostLabel: hostLabel && hostLabel.trim() !== '' ? hostLabel : undefined,
      registeredAt: now,
      lastPostedAt: undefined,
      manuallyAdded: false,
    });
  }
}

/** Merge a list of persisted hosts into the registry. Called from hydrate(). */
export function hydrateHosts(hosts: HostInfo[]): void {
  for (const h of hosts) {
    const existing = registry.get(h.hostId);
    if (!existing) {
      registry.set(h.hostId, h);
    } else {
      // Prefer hydrated data; keep manuallyAdded sticky — once true, stays true
      const merged: HostInfo = {
        ...existing,
        ...h,
        manuallyAdded: existing.manuallyAdded || h.manuallyAdded,
      };
      registry.set(h.hostId, merged);
    }
  }
}

/** Test-only: wipe all state. */
export function clearHosts(): void {
  registry.clear();
}
