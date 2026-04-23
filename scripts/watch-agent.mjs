#!/usr/bin/env node
// Usage: node scripts/watch-agent.mjs <jsonl-path>
import { createReadStream, statSync } from 'fs';
import { createInterface } from 'readline';
import { resolve } from 'path';

const path = process.argv[2];
if (!path) {
  console.error('Usage: watch-agent.mjs <jsonl-path>');
  process.exit(1);
}
const absPath = resolve(path);

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

function summarizeTool(block) {
  const i = block.input || {};
  switch (block.name) {
    case 'Edit':
    case 'Write':
    case 'Read':
      return i.file_path || '';
    case 'Bash':
      return (i.command || '').slice(0, 120);
    case 'Grep':
    case 'Glob':
      return `"${i.pattern}"`;
    case 'TaskCreate':
      return i.subject || '';
    case 'TaskUpdate':
      return `#${i.taskId} → ${i.status || ''}`;
    case 'Agent':
      return `${i.subagent_type} "${i.description || ''}"`;
    default:
      return JSON.stringify(i).slice(0, 100);
  }
}

function pretty(line) {
  let evt;
  try {
    evt = JSON.parse(line);
  } catch {
    return;
  }
  const ts = evt.timestamp
    ? new Date(evt.timestamp).toTimeString().slice(0, 8)
    : '--:--:--';
  const msg = evt.message;
  if (!msg) return;

  if (msg.role === 'assistant' && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text') {
        console.log(
          `${C.dim}${ts}${C.reset} ${C.magenta}✎ TEXT${C.reset}   ${block.text.slice(0, 200)}`,
        );
      } else if (block.type === 'tool_use') {
        console.log(
          `${C.dim}${ts}${C.reset} ${C.cyan}▶ ${block.name.padEnd(8)}${C.reset} ${summarizeTool(block)}`,
        );
      }
    }
  } else if (msg.role === 'user' && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        const text = Array.isArray(block.content)
          ? (block.content.find((c) => c.type === 'text')?.text || '').slice(0, 250)
          : String(block.content || '').slice(0, 250);
        console.log(
          `${C.dim}${ts}${C.reset} ${C.green}✓ RESULT ${C.reset} ${text}`,
        );
      }
    }
  }
}

console.log(`${C.bold}${C.cyan}▓▓ MISSION CONTROL · WATCH LIVE ▓▓${C.reset}`);
console.log(`${C.dim}${absPath}${C.reset}`);
console.log(`${C.dim}${'─'.repeat(80)}${C.reset}`);

let offset = 0;

async function readNew() {
  try {
    const stat = statSync(absPath);
    if (stat.size <= offset) return;
    const stream = createReadStream(absPath, { start: offset, end: stat.size - 1 });
    const rl = createInterface({ input: stream });
    const lines = [];
    await new Promise((resolve) => {
      rl.on('line', (line) => lines.push(line));
      rl.on('close', resolve);
    });
    for (const line of lines) {
      pretty(line);
    }
    offset = stat.size;
  } catch {
    // File may not yet exist
  }
}

await readNew();
setInterval(readNew, 750);
process.stdin.resume();
process.on('SIGINT', () => {
  console.log('\nBye.');
  process.exit(0);
});
