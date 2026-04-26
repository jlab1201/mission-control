import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { ensureWatcherStarted } from '@/server/watcher';
import { registry } from '@/server/watcher/registry';
import { assertPathInHome, expandTilde } from '@/server/workspace/pathGuard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

// Strict id guard — only hex-like subagent ids or 'main'
const SAFE_ID = /^[a-z0-9]{1,40}$/;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  ensureWatcherStarted();

  const { id } = await params;

  if (!id || !SAFE_ID.test(id)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid agent id' } },
      { status: 400 },
    );
  }

  const agent = registry.getAgent(id);
  if (!agent) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Agent not found' } },
      { status: 404 },
    );
  }

  if (!process.env.TMUX) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_IN_TMUX',
          message:
            'Dev server must be launched inside a tmux session for Watch Live to work.',
        },
      },
      { status: 400 },
    );
  }

  // Validate transcriptPath before using it as an execFile argv element.
  // Defence-in-depth: must be inside home directory and must be a .jsonl file.
  try {
    assertPathInHome(agent.transcriptPath);
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_PATH', message: 'Invalid transcript path' } },
      { status: 400 },
    );
  }
  if (!agent.transcriptPath.endsWith('.jsonl')) {
    return NextResponse.json(
      { error: { code: 'INVALID_PATH', message: 'Invalid transcript path' } },
      { status: 400 },
    );
  }

  // MC_WATCH_SCRIPT_PATH overrides the default; when set, use it directly
  // (do not prepend cwd — the user's path is already absolute).
  const scriptPath = expandTilde(
    process.env.MC_WATCH_SCRIPT_PATH ?? join(process.cwd(), 'scripts', 'watch-agent.mjs'),
  );
  const windowName = `watch-${agent.name}`;

  try {
    // execFile with argv array — never interpolates user input into a shell string.
    // '--' separates tmux flags from the command, then node/scriptPath/transcriptPath
    // are discrete argv elements so no shell expansion can occur.
    await execFileAsync('tmux', [
      'new-window',
      '-n',
      windowName,
      '--',
      'node',
      scriptPath,
      agent.transcriptPath,
    ]);
    return NextResponse.json({ data: { ok: true, window: windowName } });
  } catch (err) {
    console.error('[POST /api/agents/[id]/watch]', err);
    return NextResponse.json(
      { error: { code: 'TMUX_ERROR', message: 'Failed to open tmux window' } },
      { status: 500 },
    );
  }
}
