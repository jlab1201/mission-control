/**
 * Regression test for I6 — corrupted config.json silent reset.
 *
 * Verifies that readConfig():
 *   1. Returns the default config (not throwing) when config.json contains
 *      invalid JSON.
 *   2. Renames the corrupt file to a `.bak-*` sibling so data is never
 *      silently destroyed by the next write.
 */

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TMP_DIR = path.join(os.tmpdir(), `mc-config-test-${process.pid}`);
const TMP_CONFIG = path.join(TMP_DIR, 'config.json');

// Reset the module registry before each test so CONFIG_PATH is re-evaluated
// from the freshly set env var, and the in-module writeChain is reset.
beforeEach(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });
  process.env.MC_CONFIG_PATH = TMP_CONFIG;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.MC_CONFIG_PATH;
  vi.resetModules();
  const entries = await fs.readdir(TMP_DIR).catch(() => [] as string[]);
  await Promise.all(entries.map((e) => fs.unlink(path.join(TMP_DIR, e)).catch(() => undefined)));
  await fs.rmdir(TMP_DIR).catch(() => undefined);
});

async function importReadConfig() {
  // Dynamic import after vi.resetModules() gives us a fresh module instance
  // where CONFIG_PATH is evaluated from the current env.
  const mod = await import('../../src/server/workspace/config');
  return mod.readConfig;
}

describe('readConfig — I6 corrupt file handling', () => {
  it('returns defaults and creates a .bak-* sibling when config.json is malformed JSON', async () => {
    // Write obviously invalid JSON
    await fs.writeFile(TMP_CONFIG, '{ this is not json !!!', 'utf-8');

    const readConfig = await importReadConfig();
    const cfg = await readConfig();

    // 1. Returns default config
    expect(cfg).toEqual({
      watchPath: null,
      recentPaths: [],
      registeredProjects: [],
    });

    // 2. Original file no longer exists at TMP_CONFIG (was renamed away)
    expect(existsSync(TMP_CONFIG)).toBe(false);

    // 3. A .bak-* sibling was created in the same directory
    const siblings = await fs.readdir(TMP_DIR);
    const bak = siblings.find((f) => f.startsWith('config.json.bak-'));
    expect(bak).toBeDefined();

    // 4. The backup contains the original corrupt content
    const bakContent = await fs.readFile(path.join(TMP_DIR, bak!), 'utf-8');
    expect(bakContent).toBe('{ this is not json !!!');
  });

  it('returns defaults silently when config.json does not exist (first-run path)', async () => {
    // Ensure file definitely does not exist
    await fs.unlink(TMP_CONFIG).catch(() => undefined);

    const readConfig = await importReadConfig();
    const cfg = await readConfig();

    expect(cfg).toEqual({
      watchPath: null,
      recentPaths: [],
      registeredProjects: [],
    });

    // No backup file should have been created
    const siblings = await fs.readdir(TMP_DIR);
    expect(siblings.filter((f) => f.startsWith('config.json.bak-'))).toHaveLength(0);
  });
});
