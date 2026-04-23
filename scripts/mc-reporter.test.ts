/**
 * mc-reporter.test.ts — integration test for the mc-reporter script.
 *
 * Boots a local HTTP server on a random port, spawns the reporter as a child
 * process with --once, and asserts that the server receives a well-formed
 * snapshot POST.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { spawn, ChildProcess } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startMockServer(): Promise<{
  url: string;
  waitForPost: () => Promise<{ body: unknown; authHeader: string | undefined }>;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    let pendingResolve: ((v: { body: unknown; authHeader: string | undefined }) => void) | null =
      null;
    let pendingReject: ((e: Error) => void) | null = null;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'POST' && req.url === '/api/ingest') {
        let raw = '';
        req.on('data', (chunk: Buffer) => {
          raw += chunk.toString();
        });
        req.on('end', () => {
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true }));
          if (pendingResolve) {
            pendingResolve({ body, authHeader: req.headers['authorization'] });
            pendingResolve = null;
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not get server address'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}`;

      resolve({
        url,
        waitForPost: () =>
          new Promise((res, rej) => {
            pendingResolve = res;
            pendingReject = rej;
          }),
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });

    server.on('error', reject);
  });
}

function spawnReporter(
  targetUrl: string,
  extraEnv: Record<string, string> = {},
): ChildProcess {
  const repoRoot = join(__dirname, '..');
  return spawn(
    'node',
    ['--import', 'tsx', join(repoRoot, 'scripts', 'mc-reporter.ts'), '--once'],
    {
      env: {
        ...process.env,
        MC_REPORTER_TARGET_URL: targetUrl,
        MC_REPORTER_TOKEN: 'testtoken',
        MC_REPORTER_HOST_ID: 'test-host',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mc-reporter --once', () => {
  let server: Awaited<ReturnType<typeof startMockServer>> | null = null;
  let child: ChildProcess | null = null;
  // Create a temp dir with no JSONL files (simulates no active session)
  const tmpWatchPath = mkdtempSync(join(tmpdir(), 'mc-reporter-test-'));

  afterAll(async () => {
    child?.kill();
    await server?.close().catch(() => {});
  });

  it(
    'sends a snapshot POST on --once even when no session exists',
    async () => {
      server = await startMockServer();

      const postPromise = server.waitForPost();

      child = spawnReporter(server.url, {
        WATCH_PROJECT_PATH: tmpWatchPath,
        // Speed up any internal intervals to avoid waiting
        MC_REPORTER_BATCH_INTERVAL_MS: '100',
        MC_REPORTER_SNAPSHOT_INTERVAL_MS: '60000',
        MC_REPORTER_HTTP_TIMEOUT_MS: '5000',
      });

      // Wait up to 10 seconds for the mock server to receive the POST
      const received = await Promise.race([
        postPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timed out waiting for POST from reporter')), 10_000),
        ),
      ]);

      // Assert auth header
      expect(received.authHeader).toBe('Bearer testtoken');

      // Assert body shape
      const body = received.body as Record<string, unknown>;
      expect(body).toMatchObject({
        hostId: 'test-host',
        mode: 'snapshot',
      });
      expect(body).toHaveProperty('payload');
      // payload may be empty (no session) but must be an object
      expect(typeof body.payload).toBe('object');
    },
    15_000, // test timeout
  );
});
