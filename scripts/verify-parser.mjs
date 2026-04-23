#!/usr/bin/env node
/**
 * verify-parser.mjs
 *
 * Reads every JSONL file from the known subagent directory, parses each line,
 * and reports success / failure counts.
 *
 * Uses the same logic as the TS parser (JSON.parse per line, skip blanks) so
 * the verification is faithful to the real parser behaviour without needing
 * ts-node at runtime.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const SUBAGENT_DIR = process.argv[2] ?? process.env.MC_SUBAGENT_DIR ?? null;

if (!SUBAGENT_DIR) {
  console.error(
    'Usage: node verify-parser.mjs <subagent-dir>\n' +
    '       MC_SUBAGENT_DIR=<subagent-dir> node verify-parser.mjs\n' +
    '\n' +
    'ERROR: no subagent directory specified. ' +
    'Pass it as the first argument or set MC_SUBAGENT_DIR.',
  );
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────

function parseJsonlLines(buffer) {
  const lines = buffer.split('\n');
  const leftover = lines.pop() ?? '';
  const entries = [];
  const failures = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch (err) {
      failures.push({ line: trimmed.slice(0, 120), error: err.message });
    }
  }

  return { entries, leftover, failures };
}

function validateShape(entry) {
  const warnings = [];
  if (typeof entry.type !== 'string') warnings.push('missing .type');
  // isSidechain is optional but if present must be boolean
  if ('isSidechain' in entry && typeof entry.isSidechain !== 'boolean') {
    warnings.push('.isSidechain is not boolean');
  }
  return warnings;
}

// ── main ───────────────────────────────────────────────────────────────────

if (!existsSync(SUBAGENT_DIR)) {
  console.error(`ERROR: subagent directory not found:\n  ${SUBAGENT_DIR}`);
  process.exit(1);
}

const files = readdirSync(SUBAGENT_DIR).filter((f) => f.endsWith('.jsonl'));

if (files.length === 0) {
  console.error('ERROR: no .jsonl files found in subagent directory');
  process.exit(1);
}

console.log(`\nVerifying parser against ${files.length} JSONL file(s) in:\n  ${SUBAGENT_DIR}\n`);
console.log('─'.repeat(70));

let totalLines = 0;
let totalParsed = 0;
let totalFailed = 0;
let totalShapeWarnings = 0;

for (const file of files) {
  const fullPath = join(SUBAGENT_DIR, file);
  const buffer = readFileSync(fullPath, 'utf8');
  const { entries, leftover, failures } = parseJsonlLines(buffer);

  // Shape validation
  const shapeWarnings = [];
  for (const entry of entries) {
    const warns = validateShape(entry);
    if (warns.length) shapeWarnings.push({ entry, warns });
  }

  const lineCount = entries.length + failures.length + (leftover.trim() ? 1 : 0);
  totalLines += lineCount;
  totalParsed += entries.length;
  totalFailed += failures.length;
  totalShapeWarnings += shapeWarnings.length;

  const status = failures.length === 0 ? 'OK  ' : 'FAIL';
  console.log(`[${status}] ${file}`);
  console.log(
    `      lines: ${lineCount}  parsed: ${entries.length}  failed: ${failures.length}` +
    (leftover.trim() ? '  partial-leftover: 1' : '') +
    (shapeWarnings.length ? `  shape-warnings: ${shapeWarnings.length}` : ''),
  );

  if (failures.length > 0) {
    for (const f of failures.slice(0, 5)) {
      console.log(`      FAIL: ${f.error}`);
      console.log(`            ${f.line}`);
    }
    if (failures.length > 5) console.log(`      ... (${failures.length - 5} more failures)`);
  }

  if (shapeWarnings.length > 0) {
    for (const w of shapeWarnings.slice(0, 3)) {
      console.log(`      WARN shape: ${w.warns.join(', ')}`);
    }
  }
}

console.log('─'.repeat(70));
console.log(`\nSUMMARY`);
console.log(`  Files      : ${files.length}`);
console.log(`  Total lines: ${totalLines}`);
console.log(`  Parsed OK  : ${totalParsed}`);
console.log(`  Parse fail : ${totalFailed}`);
console.log(`  Shape warns: ${totalShapeWarnings}`);

const successRate = totalLines > 0
  ? ((totalParsed / (totalParsed + totalFailed)) * 100).toFixed(2)
  : '100.00';
console.log(`  Success    : ${successRate}%\n`);

if (totalFailed > 0) {
  console.error('RESULT: FAIL — some lines could not be parsed');
  process.exit(1);
} else {
  console.log('RESULT: PASS — all lines parsed successfully');
  process.exit(0);
}
