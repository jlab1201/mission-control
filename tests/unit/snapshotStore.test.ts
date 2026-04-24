import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadSnapshot } from '@/server/persistence/snapshotStore';
import type { RegistrySnapshot } from '@/types';

// Use a per-test tmp directory so MC_STATE_DIR isolation is clean
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-snapshot-test-'));
  process.env.MC_STATE_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.MC_STATE_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Minimal valid v2 snapshot fixture
const v2Snapshot: RegistrySnapshot = {
  version: 2,
  savedAt: new Date().toISOString(),
  sessionId: 'test-session',
  cwd: '/home/user/project',
  lastSeq: 42,
  agents: [],
  tasks: [],
  events: [],
  knownHosts: [],
};

// Minimal valid v1 snapshot fixture
const v1Snapshot: RegistrySnapshot = {
  version: 1,
  savedAt: new Date().toISOString(),
  sessionId: null,
  cwd: null,
  lastSeq: 0,
  agents: [],
  tasks: [],
  events: [],
};

async function writeFixture(projectPath: string, data: unknown): Promise<void> {
  const slug = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  const dest = path.join(tmpDir, `${slug}.json`);
  await fs.writeFile(dest, JSON.stringify(data), 'utf-8');
}

describe('loadSnapshot', () => {
  it('returns a non-null object for a valid v2 snapshot', async () => {
    await writeFixture('/home/user/my-project', v2Snapshot);

    const result = await loadSnapshot('/home/user/my-project');

    expect(result).not.toBeNull();
    expect(result?.version).toBe(2);
    expect(result?.sessionId).toBe('test-session');
    expect(result?.lastSeq).toBe(42);
  });

  it('returns a non-null object for a valid v1 snapshot', async () => {
    await writeFixture('/home/user/my-project', v1Snapshot);

    const result = await loadSnapshot('/home/user/my-project');

    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);
  });

  it('returns null for an unknown version (e.g. version 99)', async () => {
    await writeFixture('/home/user/my-project', { ...v2Snapshot, version: 99 });

    const result = await loadSnapshot('/home/user/my-project');

    expect(result).toBeNull();
  });

  it('returns null when no snapshot file exists', async () => {
    const result = await loadSnapshot('/home/user/nonexistent-project');

    expect(result).toBeNull();
  });
});
