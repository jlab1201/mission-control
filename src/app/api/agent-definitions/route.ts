import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getWatchedProjectPath } from '@/server/watcher/sessionLocator';
import type { AgentDefinition } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CODENAMES = [
  'Atlas',
  'Orion',
  'Nova',
  'Vega',
  'Apollo',
  'Kepler',
  'Lyra',
  'Phoenix',
  'Luna',
  'Sirius',
  'Andromeda',
  'Cassiopeia',
  'Perseus',
  'Draco',
  'Cygnus',
  'Pegasus',
];

/** Deterministic codename — same filename always yields the same name. */
function codenameFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return CODENAMES[Math.abs(hash) % CODENAMES.length];
}

/** Minimal YAML frontmatter parser — supports `key: value` lines, trims surrounding quotes. */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const raw of match[1].split(/\r?\n/)) {
    const idx = raw.indexOf(':');
    if (idx === -1) continue;
    const key = raw.slice(0, idx).trim();
    let value = raw.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function firstSentence(text: string, maxLen = 90): string {
  if (!text) return '';
  const cleaned = text.trim();
  const dotIdx = cleaned.indexOf('.');
  const first = dotIdx > 0 ? cleaned.slice(0, dotIdx) : cleaned;
  return first.length > maxLen ? first.slice(0, maxLen).trimEnd() + '…' : first;
}

export async function GET(): Promise<Response> {
  const projectPath = getWatchedProjectPath();
  const agentsDir = join(projectPath, '.claude', 'agents');

  if (!existsSync(agentsDir)) {
    return NextResponse.json({ data: [] satisfies AgentDefinition[] });
  }

  let files: string[];
  try {
    // Defense-in-depth: require .md extension AND reject any name containing a
    // path separator, preventing traversal via crafted filenames.
    files = readdirSync(agentsDir).filter(
      (f) => f.endsWith('.md') && !f.includes('/'),
    );
  } catch {
    return NextResponse.json({ data: [] satisfies AgentDefinition[] });
  }

  const defs: AgentDefinition[] = [];
  for (const file of files.sort()) {
    try {
      const raw = readFileSync(join(agentsDir, file), 'utf-8');
      const fm = parseFrontmatter(raw);
      const baseName = file.replace(/\.md$/, '');
      const name = fm.name || codenameFor(baseName);
      const description = fm.description ?? '';
      defs.push({
        name,
        role: firstSentence(description),
        description,
        model: fm.model || undefined,
        color: fm.color || undefined,
      });
    } catch {
      // skip unreadable file
    }
  }

  return NextResponse.json({ data: defs });
}
