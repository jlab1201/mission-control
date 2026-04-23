import { describe, it, expect } from 'vitest';
import { detectPhase } from '@/server/watcher/phaseDetector';

describe('detectPhase', () => {
  // --- isCompleted overrides everything ---

  it('returns "done" when isCompleted is true regardless of tool history', () => {
    expect(detectPhase(['Read', 'Edit', 'Bash'], true)).toBe('done');
  });

  it('returns "done" when isCompleted is true and window is empty', () => {
    expect(detectPhase([], true)).toBe('done');
  });

  // --- empty window ---

  it('returns "spawning" when tool window is empty and not completed', () => {
    expect(detectPhase([], false)).toBe('spawning');
  });

  // --- implementing branch ---

  it('returns "implementing" when all recent tools are implement tools', () => {
    expect(detectPhase(['Edit', 'Write', 'Bash', 'Edit', 'MultiEdit'], false)).toBe('implementing');
  });

  it('returns "implementing" when implementCount > exploreCount', () => {
    // 3 implement, 1 explore → implementing
    expect(detectPhase(['Read', 'Edit', 'Bash', 'Write'], false)).toBe('implementing');
  });

  it('returns "implementing" when implementCount === exploreCount (tie goes to implementing)', () => {
    // 1 implement, 1 explore → equal: implementCount >= exploreCount && implementCount > 0 → implementing
    expect(detectPhase(['Read', 'Bash'], false)).toBe('implementing');
  });

  // --- exploring branch ---

  it('returns "exploring" when all recent tools are explore tools', () => {
    expect(detectPhase(['Read', 'Grep', 'Glob', 'LS', 'Cat'], false)).toBe('exploring');
  });

  it('returns "exploring" when exploreCount > implementCount', () => {
    // 3 explore, 1 implement
    expect(detectPhase(['Read', 'Grep', 'Glob', 'Bash'], false)).toBe('exploring');
  });

  // --- default / unknown tools ---

  it('returns "spawning" when single tool is an unknown tool name', () => {
    // Unknown tool contributes to neither bucket → implementCount=0, exploreCount=0 → spawning
    expect(detectPhase(['SomeUnknownTool'], false)).toBe('spawning');
  });

  it('returns "spawning" when all tools in window are unknown tool names', () => {
    expect(detectPhase(['TodoWrite', 'Agent', 'Dispatch'], false)).toBe('spawning');
  });

  // --- window is capped at last 5 ---

  it('only looks at last 5 tool uses regardless of window length', () => {
    // The first 10 are explore tools but the last 5 are all implement tools
    const tools = Array(10).fill('Read').concat(['Edit', 'Write', 'Bash', 'Edit', 'Bash']);
    expect(detectPhase(tools, false)).toBe('implementing');
  });

  // --- mixed / near-equal window ---

  it('returns "implementing" for 2 implement vs 1 explore in window', () => {
    expect(detectPhase(['Read', 'Bash', 'Write'], false)).toBe('implementing');
  });

  it('returns "exploring" for 2 explore vs 1 implement in window', () => {
    expect(detectPhase(['Bash', 'Read', 'Grep'], false)).toBe('exploring');
  });
});
