#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'scripts/mc-reporter.ts');
const outfile = resolve(root, 'public/mc-reporter.mjs');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));

mkdirSync(dirname(outfile), { recursive: true });

// Shebang is already on line 1 of scripts/mc-reporter.ts and survives bundling,
// so the banner here must NOT include a second `#!/usr/bin/env node` — Node would
// read the second shebang as invalid JS (it's only special on line 1).
const banner = `// Mission Control Reporter — v${pkg.version}
// Run: node mc-reporter.mjs
// Requires: Node 20+, env vars MC_REPORTER_TARGET_URL, MC_REPORTER_TOKEN, MC_REPORTER_HOST_ID.
// Docs: /docs/multi-host-setup.md in the MC repo.
`;

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: banner },
  minify: false,          // readable artifact, aids debugging across hosts
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

// Size guard — warn if the bundle balloons past 500 KB
const bytes = readFileSync(outfile).byteLength;
const kb = (bytes / 1024).toFixed(1);
console.log(`[build-reporter] wrote ${outfile} (${kb} KB)`);
if (bytes > 500 * 1024) {
  console.warn(`[build-reporter] WARN: bundle exceeds 500 KB — check for unintended deps`);
}
