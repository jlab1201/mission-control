import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// hostRegistry unit tests
// ---------------------------------------------------------------------------
// These tests import from the module under test directly. The hostRegistry
// module is a simple in-memory Map — no external deps to mock.
// ---------------------------------------------------------------------------

import {
  touchHost,
  seedLocalHost,
  getAllHosts,
  isKnownHost,
  clearHosts,
  registerHost,
  forgetHost,
  getHost,
  hostStatus,
} from '@/server/ingest/hostRegistry';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Clear host map between tests
  clearHosts();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hostRegistry', () => {
  // ── touchHost ─────────────────────────────────────────────────────────────

  describe('touchHost', () => {
    it('upserts a new host with current timestamp', () => {
      const before = Date.now();
      touchHost('host-1', 'Host One');
      const after = Date.now();

      expect(isKnownHost('host-1')).toBe(true);

      const hosts = getAllHosts();
      const entry = hosts.find((h) => h.hostId === 'host-1');
      expect(entry).toBeDefined();
      expect(entry?.hostLabel).toBe('Host One');

      const lastPostedMs = new Date(entry!.lastPostedAt!).getTime();
      expect(lastPostedMs).toBeGreaterThanOrEqual(before);
      expect(lastPostedMs).toBeLessThanOrEqual(after);
    });

    it('updates lastPostedAt on second call', async () => {
      touchHost('host-update', 'Label');
      const firstEntry = getAllHosts().find((h) => h.hostId === 'host-update');
      const firstPostedAt = firstEntry!.lastPostedAt!;

      await new Promise((resolve) => setTimeout(resolve, 5));

      touchHost('host-update', undefined);
      const secondEntry = getAllHosts().find((h) => h.hostId === 'host-update');

      const t1 = new Date(firstPostedAt).getTime();
      const t2 = new Date(secondEntry!.lastPostedAt!).getTime();
      expect(t2).toBeGreaterThanOrEqual(t1);
    });

    it('preserves existing hostLabel when second call provides no label', async () => {
      touchHost('host-label', 'My Host Label');
      await new Promise((resolve) => setTimeout(resolve, 5));

      touchHost('host-label', undefined);

      const entry = getAllHosts().find((h) => h.hostId === 'host-label');
      expect(entry?.hostLabel).toBe('My Host Label');
    });

    it('updates hostLabel when a new label is provided on second call', () => {
      touchHost('host-relabel', 'Old Label');
      touchHost('host-relabel', 'New Label');

      const entry = getAllHosts().find((h) => h.hostId === 'host-relabel');
      expect(entry?.hostLabel).toBe('New Label');
    });

    it('stores watchedProjectPath from meta', () => {
      touchHost('host-wpp', 'Label', { watchedProjectPath: '/x/y/z' });

      const entry = getHost('host-wpp');
      expect(entry?.watchedProjectPath).toBe('/x/y/z');
    });

    it('updates watchedProjectPath on subsequent touch', () => {
      touchHost('host-wpp2', 'Label', { watchedProjectPath: '/old' });
      touchHost('host-wpp2', 'Label', { watchedProjectPath: '/new' });

      const entry = getHost('host-wpp2');
      expect(entry?.watchedProjectPath).toBe('/new');
    });

    it('does not clobber manuallyAdded: true flag', () => {
      registerHost({ hostId: 'manual-touch', hostLabel: 'Manual' });
      touchHost('manual-touch', 'Reporter Label');

      const entry = getHost('manual-touch');
      expect(entry?.manuallyAdded).toBe(true);
    });
  });

  // ── seedLocalHost ─────────────────────────────────────────────────────────

  describe('seedLocalHost', () => {
    it('reads MC_HOST_ID and MC_HOST_LABEL to populate the local host', () => {
      vi.stubEnv('MC_HOST_ID', 'my-machine');
      vi.stubEnv('MC_HOST_LABEL', 'My Development Machine');

      seedLocalHost();

      expect(isKnownHost('my-machine')).toBe(true);

      const entry = getAllHosts().find((h) => h.hostId === 'my-machine');
      expect(entry?.hostLabel).toBe('My Development Machine');
    });

    it('defaults to "local" when MC_HOST_ID is not set', () => {
      vi.stubEnv('MC_HOST_ID', '');
      vi.stubEnv('MC_HOST_LABEL', '');

      seedLocalHost();

      expect(isKnownHost('local')).toBe(true);
    });

    it('handles missing MC_HOST_LABEL gracefully (undefined label)', () => {
      vi.stubEnv('MC_HOST_ID', 'bare-host');
      vi.stubEnv('MC_HOST_LABEL', '');

      seedLocalHost();

      const entry = getAllHosts().find((h) => h.hostId === 'bare-host');
      expect(entry).toBeDefined();
      expect(entry?.hostLabel == null || entry?.hostLabel === '').toBe(true);
    });
  });

  // ── getAllHosts ────────────────────────────────────────────────────────────

  describe('getAllHosts', () => {
    it('returns all registered hosts', () => {
      touchHost('h1', undefined);
      touchHost('h2', undefined);
      touchHost('h3', undefined);

      const hosts = getAllHosts();
      expect(hosts).toHaveLength(3);
    });

    it('returns empty array when no hosts exist', () => {
      expect(getAllHosts()).toHaveLength(0);
    });
  });

  // ── isKnownHost ───────────────────────────────────────────────────────────

  describe('isKnownHost', () => {
    it('returns true for a host that has been touched', () => {
      touchHost('known-host', undefined);
      expect(isKnownHost('known-host')).toBe(true);
    });

    it('returns false for a host that has not been touched', () => {
      expect(isKnownHost('unknown-host-xyz')).toBe(false);
    });

    it('returns false after clearHosts()', () => {
      touchHost('was-known', undefined);
      clearHosts();
      expect(isKnownHost('was-known')).toBe(false);
    });
  });

  // ── registerHost ──────────────────────────────────────────────────────────

  describe('registerHost', () => {
    it('creates a new manually added host', () => {
      const host = registerHost({ hostId: 'new-manual', hostLabel: 'Lab', hostname: 'lab.local', ipAddress: '10.0.0.1' });

      expect(host.hostId).toBe('new-manual');
      expect(host.hostLabel).toBe('Lab');
      expect(host.hostname).toBe('lab.local');
      expect(host.ipAddress).toBe('10.0.0.1');
      expect(host.manuallyAdded).toBe(true);
      expect(host.lastPostedAt).toBeUndefined();
      expect(host.registeredAt).toBeDefined();
    });

    it('promotes an auto-discovered host to manually added', () => {
      touchHost('auto-host', 'Auto');
      const beforePostedAt = getHost('auto-host')!.lastPostedAt;

      const host = registerHost({ hostId: 'auto-host', hostLabel: 'Promoted' });

      expect(host.manuallyAdded).toBe(true);
      expect(host.lastPostedAt).toBe(beforePostedAt); // preserved
      expect(host.hostLabel).toBe('Promoted');
    });

    it('re-registering a manual host updates metadata and keeps manuallyAdded', () => {
      registerHost({ hostId: 're-register', hostname: 'first.local' });
      const host = registerHost({ hostId: 're-register', hostname: 're.local' });

      expect(host.hostname).toBe('re.local');
      expect(host.manuallyAdded).toBe(true);
    });
  });

  // ── forgetHost ────────────────────────────────────────────────────────────

  describe('forgetHost', () => {
    it('removes a known non-local host and returns true', () => {
      touchHost('removable', undefined);
      expect(isKnownHost('removable')).toBe(true);

      const result = forgetHost('removable');
      expect(result).toBe(true);
      expect(isKnownHost('removable')).toBe(false);
    });

    it('returns false for an unknown host', () => {
      expect(forgetHost('ghost')).toBe(false);
    });

    it('refuses to forget the local host and returns false', () => {
      vi.stubEnv('MC_HOST_ID', 'local');
      seedLocalHost();

      const result = forgetHost('local');
      expect(result).toBe(false);
      expect(isKnownHost('local')).toBe(true);
    });
  });

  // ── hostStatus ────────────────────────────────────────────────────────────

  describe('hostStatus', () => {
    it('returns "unknown" for a host not in registry', () => {
      expect(hostStatus('ghost')).toBe('unknown');
    });

    it('returns "pending" when lastPostedAt is undefined', () => {
      registerHost({ hostId: 'pending-host' });
      expect(hostStatus('pending-host')).toBe('pending');
    });

    it('returns "live" when lastPostedAt is within 60s', () => {
      touchHost('live-host', undefined);
      // Use a nowMs just slightly after the touch
      const nowMs = Date.now() + 1;
      expect(hostStatus('live-host', nowMs)).toBe('live');
    });

    it('returns "stale" when lastPostedAt is older than 60s', () => {
      touchHost('stale-host', undefined);
      const nowMs = Date.now() + 61_000;
      expect(hostStatus('stale-host', nowMs)).toBe('stale');
    });
  });
});
