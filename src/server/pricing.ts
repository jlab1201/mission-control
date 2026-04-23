import type { RawUsage } from './watcher/jsonlParser';

/**
 * Per-model pricing in USD per 1M tokens.
 * Unknown models → 0 cost (tokens still counted).
 * Rates updated to public Anthropic pricing as of 2026.
 */
interface ModelRate {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

const OPUS_RATE: ModelRate = {
  input: 15,
  cacheWrite: 18.75,
  cacheRead: 1.5,
  output: 75,
};

const SONNET_RATE: ModelRate = {
  input: 3,
  cacheWrite: 3.75,
  cacheRead: 0.3,
  output: 15,
};

const HAIKU_RATE: ModelRate = {
  input: 1,
  cacheWrite: 1.25,
  cacheRead: 0.08,
  output: 5,
};

function rateFor(model?: string): ModelRate | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes('opus')) return OPUS_RATE;
  if (m.includes('sonnet')) return SONNET_RATE;
  if (m.includes('haiku')) return HAIKU_RATE;
  return null;
}

/** Incremental cost contribution for a single assistant message. */
export function costForUsage(model: string | undefined, usage: RawUsage): number {
  const rate = rateFor(model);
  if (!rate) return 0;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (input * rate.input +
      output * rate.output +
      cacheWrite * rate.cacheWrite +
      cacheRead * rate.cacheRead) /
    1_000_000
  );
}
