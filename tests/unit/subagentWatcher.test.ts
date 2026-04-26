import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, appendFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SubagentWatcher } from '@/server/watcher/subagentWatcher';
import { registry } from '@/server/watcher/registry';
import type { Agent } from '@/types';

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `subagent-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
  registry.clear();
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(testDir, { recursive: true, force: true });
});

function makeAgent(id: string, transcriptPath: string): Agent {
  const now = new Date().toISOString();
  return {
    id,
    type: 'subagent',
    name: 'web-scraper',
    status: 'active',
    phase: 'exploring',
    startedAt: now,
    lastActiveAt: now,
    toolUseCount: 0,
    transcriptPath,
    recentToolUseTimestamps: [],
    tokensIn: 0,
    tokensOut: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    estCostUsd: 0,
    hostId: 'local',
  };
}

function toolUseLine(id: string, name: string, isSidechain = false): string {
  return (
    JSON.stringify({
      timestamp: new Date().toISOString(),
      isSidechain,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name, input: {} }],
      },
    }) + '\n'
  );
}

function toolResultLine(toolUseId: string, isSidechain = false): string {
  return (
    JSON.stringify({
      timestamp: new Date().toISOString(),
      isSidechain,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: toolUseId, content: 'ok' },
        ],
      },
    }) + '\n'
  );
}

describe('SubagentWatcher pendingTools status override', () => {
  it('keeps the agent active while a tool call is pending, even past the completed threshold', async () => {
    const agentId = 'pending-tool-test';
    const transcriptPath = join(testDir, `agent-${agentId}.jsonl`);

    // Write a tool_use line with no matching tool_result — simulates a
    // long-running Bash/playwright call that hasn't returned yet.
    await writeFile(transcriptPath, toolUseLine('tool_1', 'Bash'));
    registry.upsertAgent(makeAgent(agentId, transcriptPath));

    const watcher = new SubagentWatcher(testDir);
    watcher.add(agentId, transcriptPath);
    await watcher.coldStart();

    expect(registry.getAgent(agentId)?.status).toBe('active');

    // Simulate >10 minutes elapsing without any new transcript writes.
    // The transcript mtime stays anchored where appendFile/writeFile left it,
    // but Date.now() (the comparator side of ageMs) jumps forward.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);

    await watcher.poll();

    // Without the pendingTools override, this would be 'completed' and an
    // agent_complete event would have fired.
    expect(registry.getAgent(agentId)?.status).toBe('active');
  });

  it('transitions to completed once the matching tool_result drains pendingTools and mtime is stale', async () => {
    const agentId = 'drain-then-complete';
    const transcriptPath = join(testDir, `agent-${agentId}.jsonl`);

    await writeFile(transcriptPath, toolUseLine('tool_1', 'Bash'));
    registry.upsertAgent(makeAgent(agentId, transcriptPath));

    const watcher = new SubagentWatcher(testDir);
    watcher.add(agentId, transcriptPath);
    await watcher.coldStart();
    expect(registry.getAgent(agentId)?.status).toBe('active');

    // Tool returns: append the matching tool_result line. After the next
    // poll, pendingTools should drain.
    await appendFile(transcriptPath, toolResultLine('tool_1'));
    await watcher.poll();

    // Advance time so the now-real mtime ages past the completed threshold.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);

    await watcher.poll();

    expect(registry.getAgent(agentId)?.status).toBe('completed');
  });

  // Regression: in real Claude Code subagent transcripts, every entry is
  // written with isSidechain=true. The watcher previously filtered those out
  // on the assumption that they were duplicates of main-session traffic,
  // which dropped 100% of subagent activity and left the dashboard showing
  // stale lastActiveAt and empty pendingTools.
  it('processes entries even when isSidechain=true (real Claude Code subagent format)', async () => {
    const agentId = 'sidechain-entries';
    const transcriptPath = join(testDir, `agent-${agentId}.jsonl`);

    // The tool_use line is marked sidechain=true — exactly what Claude
    // writes for subagent transcripts in current versions.
    await writeFile(transcriptPath, toolUseLine('tool_1', 'Bash', true));
    registry.upsertAgent(makeAgent(agentId, transcriptPath));

    const watcher = new SubagentWatcher(testDir);
    watcher.add(agentId, transcriptPath);
    await watcher.coldStart();

    // If the sidechain filter were still in place, the tool_use would have
    // been ignored, pendingTools would be empty, and a 10-min jump would
    // demote the agent to completed.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    await watcher.poll();

    expect(registry.getAgent(agentId)?.status).toBe('active');
  });
});
