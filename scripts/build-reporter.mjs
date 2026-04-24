#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const bundleBytes = readFileSync(outfile);
const kb = (bundleBytes.byteLength / 1024).toFixed(1);
console.log(`[build-reporter] wrote ${outfile} (${kb} KB)`);
if (bundleBytes.byteLength > 500 * 1024) {
  console.warn(`[build-reporter] WARN: bundle exceeds 500 KB — check for unintended deps`);
}

// Supply-chain integrity — write sha256 of the bundle as a sibling file
const hash = createHash('sha256').update(bundleBytes).digest('hex');
const hashFile = `${outfile}.sha256`;
writeFileSync(hashFile, hash + '\n', 'utf-8');
console.log(`[build-reporter] wrote ${hashFile} (sha256: ${hash})`);
