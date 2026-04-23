import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, appendFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { IncrementalReader } from '@/server/watcher/incrementalReader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  // Create a fresh temp directory for each test
  testDir = join(tmpdir(), `incremental-reader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function tmpFile(name = 'test.jsonl'): string {
  return join(testDir, name);
}

// ---------------------------------------------------------------------------
// coldStart
// ---------------------------------------------------------------------------

describe('IncrementalReader.coldStart', () => {
  it('returns empty string for an empty file and advances offset to 0', async () => {
    const filePath = tmpFile();
    await writeFile(filePath, '');
    const reader = new IncrementalReader(filePath);
    const result = await reader.coldStart();
    expect(result).toBe('');
  });

  it('returns all complete lines when file is smaller than lookbackBytes', async () => {
    const filePath = tmpFile();
    await writeFile(filePath, 'line1\nline2\nline3\n');
    const reader = new IncrementalReader(filePath);
    const result = await reader.coldStart();
    expect(result).toBe('line1\nline2\nline3\n');
  });

  it('returns only last N bytes of complete lines when lookbackBytes is small', async () => {
    const filePath = tmpFile();
    // Write content that is definitely larger than our small lookback
    const longContent = 'aaaa\nbbbb\ncccc\ndddd\neeee\n';
    await writeFile(filePath, longContent);
    const reader = new IncrementalReader(filePath);
    // Use a small lookback that covers only the last few lines
    const result = await reader.coldStart(10);
    // Should return complete lines within the lookback window
    // 10 bytes back from end: "eeee\n" is 5 bytes, "dddd\n" is 5 bytes = 10 bytes
    // The result should contain only complete lines from the lookback window
    expect(result).toContain('eeee\n');
    // Should NOT contain the very beginning (aaaa)
    expect(result).not.toContain('aaaa');
  });

  it('returns empty string when lookback window has no newline and buffers leftover', async () => {
    const filePath = tmpFile();
    // Write a partial line (no newline)
    await writeFile(filePath, 'partial-no-newline');
    const reader = new IncrementalReader(filePath);
    const result = await reader.coldStart();
    expect(result).toBe('');
  });

  it('returns empty string when file does not exist (error handling)', async () => {
    const reader = new IncrementalReader(join(testDir, 'nonexistent.jsonl'));
    const result = await reader.coldStart();
    expect(result).toBe('');
  });

  it('advances offset so that subsequent readNew returns only new data', async () => {
    const filePath = tmpFile();
    await writeFile(filePath, 'line1\nline2\n');
    const reader = new IncrementalReader(filePath);
    await reader.coldStart();

    // Append new data after coldStart
    await appendFile(filePath, 'line3\n');
    const delta = await reader.readNew();
    expect(delta).toBe('line3\n');
    // Should NOT re-emit old lines
    expect(delta).not.toContain('line1');
    expect(delta).not.toContain('line2');
  });
});

// ---------------------------------------------------------------------------
// readNew
// ---------------------------------------------------------------------------

describe('IncrementalReader.readNew', () => {
  it('returns empty string when no new data has been appended', async () => {
    const filePath = tmpFile();
    await writeFile(filePath, 'line1\nline2\n');
    const reader = new IncrementalReader(filePath);
    await reader.coldStart();

    const result = await reader.readNew();
    expect(result).toBe('');
  });

  it('returns the delta when the file grows', async () => {
    const filePath = tmpFile();
    await writeFile(filePath, 'line1\n');
    const reader = new IncrementalReader(filePath);
    await reader.coldStart();

    await appendFile(filePath, 'line2\n');
    const delta = await reader.readNew();
    expect(delta).toBe('line2\n');
  });

  it('tracks offset correctly across multiple readNew calls', async () => {
    const filePath = tmpFile();
    await writeFile(filePath, 'line1\n');
    const reader = new IncrementalReader(filePath);
    await reader.coldStart();

    await appendFile(filePath, 'line2\n');
    const delta1 = await reader.readNew();
    expect(delta1).toBe('line2\n');

    await appendFile(filePath, 'line3\n');
    const delta2 = await reader.readNew();
    expect(delta2).toBe('line3\n');

    await appendFile(filePath, 'line4\n');
    const delta3 = await reader.readNew();
    expect(delta3).toBe('line4\n');
  });

  it('buffers partial line and returns it once newline arrives', async () => {
    const filePath = tmpFile();
    await writeFile(filePath, 'line1\n');
    const reader = new IncrementalReader(filePath);
    await reader.coldStart();

    // Append partial line (no newline yet)
    await appendFile(filePath, 'partial');
    const partial = await reader.readNew();
    expect(partial).toBe(''); // No complete line yet

    // Now complete the line
    await appendFile(filePath, '-complete\n');
    const complete = await reader.readNew();
    expect(complete).toBe('partial-complete\n');
  });

  it('returns empty string when file does not exist', async () => {
    const reader = new IncrementalReader(join(testDir, 'nonexistent.jsonl'));
    const result = await reader.readNew();
    expect(result).toBe('');
  });

  it('returns empty string when called on an empty file', async () => {
    const filePath = tmpFile();
    await writeFile(filePath, '');
    const reader = new IncrementalReader(filePath);
    const result = await reader.readNew();
    expect(result).toBe('');
  });

  // --- File truncation recovery ---

  it('recovers after truncation: resets offset and reads new content written after truncation', async () => {
    const filePath = tmpFile();
    await writeFile(filePath, 'line1\nline2\nline3\n');
    const reader = new IncrementalReader(filePath);
    await reader.coldStart();

    // Truncate the file to empty (simulates log rotation)
    await writeFile(filePath, '');

    // After truncation, reader should detect size < diskOffset, reset, and return ''
    const afterTruncate = await reader.readNew();
    expect(afterTruncate).toBe('');

    // New data written after rotation must be returned correctly
    await writeFile(filePath, 'new1\nnew2\n');
    const recovered = await reader.readNew();
    expect(recovered).toBe('new1\nnew2\n');
  });
});
