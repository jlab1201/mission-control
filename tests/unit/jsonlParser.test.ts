import { describe, it, expect } from 'vitest';
import {
  parseJsonlLines,
  extractToolUses,
  extractToolResults,
} from '@/server/watcher/jsonlParser';
import type { RawEntry, ToolUseBlock, ToolResultBlock } from '@/server/watcher/jsonlParser';

// ---------------------------------------------------------------------------
// parseJsonlLines
// ---------------------------------------------------------------------------

describe('parseJsonlLines', () => {
  it('parses a single valid JSONL line', () => {
    const buffer = '{"type":"summary","uuid":"abc"}\n';
    const { entries } = parseJsonlLines(buffer);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('summary');
    expect(entries[0].uuid).toBe('abc');
  });

  it('parses multiple valid JSONL lines', () => {
    const buffer = '{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n';
    const { entries } = parseJsonlLines(buffer);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.type)).toEqual(['a', 'b', 'c']);
  });

  it('discards partial line at EOF (no trailing newline)', () => {
    const buffer = '{"type":"complete"}\n{"type":"partial"';
    const { entries } = parseJsonlLines(buffer);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('complete');
  });

  it('returns empty entries when buffer has no newlines', () => {
    const buffer = '{"type":"no-newline"}';
    const { entries } = parseJsonlLines(buffer);
    expect(entries).toHaveLength(0);
  });

  it('returns empty entries for empty buffer', () => {
    const { entries } = parseJsonlLines('');
    expect(entries).toHaveLength(0);
  });

  it('skips malformed JSON lines without throwing', () => {
    const buffer = '{"type":"valid"}\nNOT_JSON_AT_ALL\n{"type":"also-valid"}\n';
    expect(() => parseJsonlLines(buffer)).not.toThrow();
    const { entries } = parseJsonlLines(buffer);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('valid');
    expect(entries[1].type).toBe('also-valid');
  });

  it('skips truncated JSON lines without throwing', () => {
    const buffer = '{"type":"ok"}\n{"broken":\n{"type":"fine"}\n';
    const { entries } = parseJsonlLines(buffer);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('ok');
    expect(entries[1].type).toBe('fine');
  });

  it('skips blank lines', () => {
    const buffer = '{"type":"a"}\n\n   \n{"type":"b"}\n';
    const { entries } = parseJsonlLines(buffer);
    expect(entries).toHaveLength(2);
  });

  it('parses entry with isSidechain flag', () => {
    const buffer = '{"type":"human","isSidechain":true,"uuid":"xyz"}\n';
    const { entries } = parseJsonlLines(buffer);
    expect(entries[0].isSidechain).toBe(true);
    expect(entries[0].uuid).toBe('xyz');
  });

  it('handles buffer with only a newline', () => {
    const { entries } = parseJsonlLines('\n');
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractToolUses
// ---------------------------------------------------------------------------

describe('extractToolUses', () => {
  it('extracts tool_use blocks from assistant message content', () => {
    const entry: RawEntry = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'Edit',
            input: { path: 'src/app.ts', content: 'hello' },
          },
        ],
      },
    };
    const tools = extractToolUses(entry);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('Edit');
    expect(tools[0].id).toBe('toolu_01');
    expect(tools[0].input).toEqual({ path: 'src/app.ts', content: 'hello' });
  });

  it('extracts multiple tool_use blocks', () => {
    const entry: RawEntry = {
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { path: 'a.ts' } },
          { type: 'text', text: 'Thinking...' },
          { type: 'tool_use', id: 'toolu_02', name: 'Write', input: { path: 'b.ts', content: '' } },
        ],
      },
    };
    const tools = extractToolUses(entry);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('Read');
    expect(tools[1].name).toBe('Write');
  });

  it('returns empty array when no tool_use blocks', () => {
    const entry: RawEntry = {
      message: {
        content: [{ type: 'text', text: 'Hello' }],
      },
    };
    expect(extractToolUses(entry)).toHaveLength(0);
  });

  it('returns empty array when content is missing', () => {
    const entry: RawEntry = { message: { role: 'assistant' } };
    expect(extractToolUses(entry)).toHaveLength(0);
  });

  it('returns empty array when message is missing', () => {
    const entry: RawEntry = { type: 'summary' };
    expect(extractToolUses(entry)).toHaveLength(0);
  });

  it('returns empty array when content is not an array', () => {
    const entry: RawEntry = {
      message: { content: 'a plain string' as unknown as never },
    };
    expect(extractToolUses(entry)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractToolResults
// ---------------------------------------------------------------------------

describe('extractToolResults', () => {
  it('extracts tool_result blocks from user message content', () => {
    const entry: RawEntry = {
      type: 'human',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01',
            content: [{ type: 'text', text: 'File saved.' }],
          },
        ],
      },
    };
    const results = extractToolResults(entry);
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe('toolu_01');
  });

  it('extracts tool_result with string content', () => {
    const entry: RawEntry = {
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_02',
            content: 'plain text result',
          },
        ],
      },
    };
    const results = extractToolResults(entry);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('plain text result');
  });

  it('extracts multiple tool_result blocks', () => {
    const entry: RawEntry = {
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_01', content: 'ok' },
          { type: 'text', text: 'something' },
          { type: 'tool_result', tool_use_id: 'toolu_02', content: 'done' },
        ],
      },
    };
    const results = extractToolResults(entry);
    expect(results).toHaveLength(2);
  });

  it('returns empty array when no tool_result blocks', () => {
    const entry: RawEntry = {
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_01', name: 'Read', input: {} },
        ],
      },
    };
    expect(extractToolResults(entry)).toHaveLength(0);
  });

  it('returns empty array when message is missing', () => {
    const entry: RawEntry = { type: 'assistant' };
    expect(extractToolResults(entry)).toHaveLength(0);
  });

  it('returns empty array when content is not an array', () => {
    const entry: RawEntry = {
      message: { content: null as unknown as never },
    };
    expect(extractToolResults(entry)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: parse then extract
// ---------------------------------------------------------------------------

describe('parse-then-extract round trip', () => {
  it('parses JSONL with tool_use content then extracts correctly', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'u1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    });
    const { entries } = parseJsonlLines(line + '\n');
    expect(entries).toHaveLength(1);
    const tools = extractToolUses(entries[0]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('Bash');
  });

  it('parses JSONL with tool_result content then extracts correctly', () => {
    const line = JSON.stringify({
      type: 'human',
      uuid: 'u2',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_01', content: [{ type: 'text', text: 'output' }] },
        ],
      },
    });
    const { entries } = parseJsonlLines(line + '\n');
    const results = extractToolResults(entries[0]);
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe('toolu_01');
  });
});
