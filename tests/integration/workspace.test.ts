import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Mock server-side side-effectful modules BEFORE importing route handlers
// ---------------------------------------------------------------------------

vi.mock('@/server/workspace/install', () => ({
  installTeamKit: vi.fn(),
}));

vi.mock('@/server/workspace/inspect', () => ({
  inspectPath: vi.fn(),
}));

vi.mock('@/server/workspace/config', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  prependRecentPath: vi.fn(),
}));

vi.mock('@/server/watcher', () => ({
  ensureWatcherStarted: vi.fn(),
  restartWatcher: vi.fn(),
}));

vi.mock('pino', () => ({
  default: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { POST as installPOST } from '@/app/api/workspace/install/route';
import { GET as inspectGET } from '@/app/api/workspace/inspect/route';
import { POST as watchPOST } from '@/app/api/workspace/watch/route';
import { POST as forgetPOST } from '@/app/api/workspace/forget/route';
import { installTeamKit } from '@/server/workspace/install';
import { inspectPath } from '@/server/workspace/inspect';
import { readConfig, writeConfig, prependRecentPath } from '@/server/workspace/config';

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockInstall = installTeamKit as ReturnType<typeof vi.fn>;
const mockInspect = inspectPath as ReturnType<typeof vi.fn>;
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>;
const mockWriteConfig = writeConfig as ReturnType<typeof vi.fn>;
const mockPrependRecentPath = prependRecentPath as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOME = os.homedir();
// A path that is safely inside home for normal tests
const SAFE_PATH = path.join(HOME, 'projects', 'my-app');

function makePostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(url: string): NextRequest {
  return new NextRequest(url);
}

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Sensible defaults
  mockWriteConfig.mockResolvedValue(undefined);
  mockPrependRecentPath.mockImplementation(
    (existing: string[], newPath: string) => [newPath, ...existing].slice(0, 5),
  );
  mockReadConfig.mockResolvedValue({ watchPath: null, recentPaths: [] });
});

// ---------------------------------------------------------------------------
// /api/workspace/install
// ---------------------------------------------------------------------------

describe('POST /api/workspace/install', () => {
  it('returns 201 with success envelope on successful install', async () => {
    mockInstall.mockResolvedValue({ status: 'installed', message: 'team-kit installed successfully' });

    const res = await installPOST(
      makePostRequest('http://localhost:3000/api/workspace/install', { path: SAFE_PATH }),
    );
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body).toMatchObject({ status: 'installed' });
  });

  it('returns 200 with skipped status when install is skipped', async () => {
    mockInstall.mockResolvedValue({ status: 'skipped', message: 'Already has .claude/ — use force: true to overwrite' });

    const res = await installPOST(
      makePostRequest('http://localhost:3000/api/workspace/install', { path: SAFE_PATH }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res) as { status: string };
    expect(body.status).toBe('skipped');
  });

  it('returns 400 with PATH_UNSAFE error code on path traversal', async () => {
    mockInstall.mockResolvedValue({ status: 'error', message: 'PATH_UNSAFE: path must be inside the home directory' });

    const res = await installPOST(
      makePostRequest('http://localhost:3000/api/workspace/install', { path: '/etc/passwd' }),
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('PATH_UNSAFE');
  });

  it('returns 500 with INSTALL_ERROR on generic install failure', async () => {
    mockInstall.mockResolvedValue({ status: 'error', message: 'Install failed: EACCES permission denied' });

    const res = await installPOST(
      makePostRequest('http://localhost:3000/api/workspace/install', { path: SAFE_PATH }),
    );
    expect(res.status).toBe(500);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('INSTALL_ERROR');
  });

  it('returns 422 when path field is missing', async () => {
    const res = await installPOST(
      makePostRequest('http://localhost:3000/api/workspace/install', {}),
    );
    expect(res.status).toBe(422);
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/workspace/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json',
    });
    const res = await installPOST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /api/workspace/inspect
// ---------------------------------------------------------------------------

describe('GET /api/workspace/inspect', () => {
  it('returns 200 with inspect result on success', async () => {
    const mockResult = {
      path: SAFE_PATH,
      state: 'empty',
      canInstall: true,
      canForceReinstall: false,
      recommendedAction: 'install',
    };
    mockInspect.mockResolvedValue(mockResult);

    const res = await inspectGET(
      makeGetRequest(`http://localhost:3000/api/workspace/inspect?path=${encodeURIComponent(SAFE_PATH)}`),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body).toMatchObject({ state: 'empty', canInstall: true });
  });

  it('returns 400 with PATH_UNSAFE error on path traversal', async () => {
    const err = Object.assign(new Error('Path is outside the home directory: /etc/passwd'), {
      code: 'PATH_UNSAFE',
    });
    mockInspect.mockRejectedValue(err);

    const res = await inspectGET(
      makeGetRequest('http://localhost:3000/api/workspace/inspect?path=%2Fetc%2Fpasswd'),
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('PATH_UNSAFE');
  });

  it('returns 400 when path query param is missing', async () => {
    const res = await inspectGET(
      makeGetRequest('http://localhost:3000/api/workspace/inspect'),
    );
    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected inspect error', async () => {
    mockInspect.mockRejectedValue(new Error('Unexpected disk failure'));

    const res = await inspectGET(
      makeGetRequest(`http://localhost:3000/api/workspace/inspect?path=${encodeURIComponent(SAFE_PATH)}`),
    );
    expect(res.status).toBe(500);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('INSPECT_ERROR');
  });
});

// ---------------------------------------------------------------------------
// /api/workspace/watch
// ---------------------------------------------------------------------------

describe('POST /api/workspace/watch', () => {
  it('returns 200 with { data: WorkspaceConfig } on success', async () => {
    const updated = { watchPath: SAFE_PATH, recentPaths: [SAFE_PATH] };
    mockReadConfig.mockResolvedValue({ watchPath: null, recentPaths: [] });
    mockPrependRecentPath.mockReturnValue([SAFE_PATH]);
    mockWriteConfig.mockResolvedValue(undefined);

    const res = await watchPOST(
      makePostRequest('http://localhost:3000/api/workspace/watch', { path: SAFE_PATH }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res) as { data: typeof updated };
    expect(body).toHaveProperty('data');
    expect(body.data.watchPath).toBe(SAFE_PATH);
  });

  it('returns 400 with PATH_UNSAFE when path is outside home (direct call with /etc/passwd)', async () => {
    // pathGuard runs synchronously in the route before any mock is called
    const res = await watchPOST(
      makePostRequest('http://localhost:3000/api/workspace/watch', { path: '/etc/passwd' }),
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('PATH_UNSAFE');
  });

  it('returns 422 when path field is missing', async () => {
    const res = await watchPOST(
      makePostRequest('http://localhost:3000/api/workspace/watch', {}),
    );
    expect(res.status).toBe(422);
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/workspace/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{{bad json',
    });
    const res = await watchPOST(req);
    expect(res.status).toBe(400);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_JSON');
  });

  it('returns 500 on config write failure', async () => {
    mockReadConfig.mockResolvedValue({ watchPath: null, recentPaths: [] });
    mockWriteConfig.mockRejectedValue(new Error('Disk full'));

    const res = await watchPOST(
      makePostRequest('http://localhost:3000/api/workspace/watch', { path: SAFE_PATH }),
    );
    expect(res.status).toBe(500);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('WATCH_UPDATE_FAILED');
  });
});

// ---------------------------------------------------------------------------
// /api/workspace/forget
// ---------------------------------------------------------------------------

describe('POST /api/workspace/forget', () => {
  it('returns 200 with { data: WorkspaceConfig } after removing path from recents', async () => {
    const otherPath = path.join(HOME, 'projects', 'other-app');
    mockReadConfig.mockResolvedValue({ watchPath: null, recentPaths: [otherPath, SAFE_PATH] });
    mockWriteConfig.mockResolvedValue(undefined);

    const res = await forgetPOST(
      makePostRequest('http://localhost:3000/api/workspace/forget', { path: SAFE_PATH }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res) as { data: { recentPaths: string[] } };
    expect(body).toHaveProperty('data');
    // The forgotten path should not be in the resulting recentPaths
    expect(body.data.recentPaths).not.toContain(SAFE_PATH);
  });

  it('returns 409 when attempting to forget the active workspace', async () => {
    mockReadConfig.mockResolvedValue({ watchPath: SAFE_PATH, recentPaths: [SAFE_PATH] });

    const res = await forgetPOST(
      makePostRequest('http://localhost:3000/api/workspace/forget', { path: SAFE_PATH }),
    );
    expect(res.status).toBe(409);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('ACTIVE_WORKSPACE');
  });

  it('returns 400 with PATH_UNSAFE on path traversal (/etc/passwd)', async () => {
    const res = await forgetPOST(
      makePostRequest('http://localhost:3000/api/workspace/forget', { path: '/etc/passwd' }),
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('PATH_UNSAFE');
  });

  it('returns 422 when path field is missing', async () => {
    const res = await forgetPOST(
      makePostRequest('http://localhost:3000/api/workspace/forget', {}),
    );
    expect(res.status).toBe(422);
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/workspace/forget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await forgetPOST(req);
    expect(res.status).toBe(400);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_JSON');
  });

  it('returns 500 on config write failure', async () => {
    const otherPath = path.join(HOME, 'projects', 'other');
    mockReadConfig.mockResolvedValue({ watchPath: null, recentPaths: [SAFE_PATH, otherPath] });
    mockWriteConfig.mockRejectedValue(new Error('Write failed'));

    const res = await forgetPOST(
      makePostRequest('http://localhost:3000/api/workspace/forget', { path: SAFE_PATH }),
    );
    expect(res.status).toBe(500);
    const body = await jsonBody(res) as { error: { code: string } };
    expect(body.error.code).toBe('FORGET_FAILED');
  });
});
