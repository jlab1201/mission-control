import { open, stat } from 'fs/promises';
import { JSONL_LOOKBACK_BYTES } from '@/lib/config/runtime';

/**
 * Reads a file incrementally, tracking a byte offset so each call to
 * readNew() only returns newly appended data since the last read.
 *
 * Key invariant: `this.offset` always points to the byte position in the
 * file where `this.leftover` begins (i.e., the start of the last partial
 * line that hasn't yet been terminated by a newline).
 */
export class IncrementalReader {
  /** Byte offset in the file where the next un-parsed content starts */
  private diskOffset = 0;
  /** Partial line buffered from the previous read (not yet newline-terminated) */
  private leftover = '';

  constructor(private readonly path: string) {}

  /**
   * Cold-start: seeks to max(0, size - lookbackBytes), reads to EOF, and
   * returns complete lines only. Advances internal offset to last newline.
   */
  async coldStart(lookbackBytes = JSONL_LOOKBACK_BYTES): Promise<string> {
    try {
      const info = await stat(this.path);
      const startByte = Math.max(0, info.size - lookbackBytes);
      const length = info.size - startByte;
      if (length <= 0) {
        this.diskOffset = info.size;
        return '';
      }

      const fh = await open(this.path, 'r');
      try {
        const buf = Buffer.allocUnsafe(length);
        const { bytesRead } = await fh.read(buf, 0, length, startByte);
        const text = buf.slice(0, bytesRead).toString('utf8');

        const lastNl = text.lastIndexOf('\n');
        if (lastNl === -1) {
          // No complete lines — buffer everything, park offset at startByte
          this.leftover = text;
          this.diskOffset = startByte;
          return '';
        }

        const complete = text.slice(0, lastNl + 1);
        this.leftover = text.slice(lastNl + 1);
        // Disk offset = start of the partial leftover in the file
        this.diskOffset = startByte + Buffer.byteLength(complete, 'utf8');
        return complete;
      } finally {
        await fh.close();
      }
    } catch {
      return '';
    }
  }

  /**
   * Reads bytes newly appended since the last successful read, prepends any
   * buffered leftover, and returns only complete lines. Partial trailing
   * line is buffered for the next call.
   */
  async readNew(): Promise<string> {
    try {
      const info = await stat(this.path);
      if (info.size < this.diskOffset) {
        // File was truncated (e.g. log rotation) — reset and re-read from start
        this.diskOffset = 0;
        this.leftover = '';
      }
      if (info.size === this.diskOffset) return '';

      const startByte = this.diskOffset;
      const length = info.size - startByte;

      const fh = await open(this.path, 'r');
      try {
        const buf = Buffer.allocUnsafe(length);
        const { bytesRead } = await fh.read(buf, 0, length, startByte);
        // Prepend any previously buffered partial line
        const text = this.leftover + buf.slice(0, bytesRead).toString('utf8');

        const lastNl = text.lastIndexOf('\n');
        if (lastNl === -1) {
          // Still no complete line — buffer everything, do NOT advance disk offset
          // (leftover prefix was already buffered before this startByte read)
          this.leftover = text;
          this.diskOffset = startByte + bytesRead;
          return '';
        }

        const complete = text.slice(0, lastNl + 1);
        const newLeftover = text.slice(lastNl + 1);

        // Disk offset advances by the new bytes we just consumed from disk
        this.diskOffset = startByte + bytesRead;
        this.leftover = newLeftover;

        return complete;
      } finally {
        await fh.close();
      }
    } catch {
      return '';
    }
  }
}
