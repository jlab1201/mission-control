import type { RawUsage } from './watcher/jsonlParser';

/**
 * Per-model pricing in USD per 1M tokens.
 * Source: https://platform.claude.com/docs/en/docs/about-claude/pricing
 * Verified: 2026-04-26.
 *
 * Unknown models → 0 cost (tokens still counted).
 */
interface ModelRate {
  input: number;
  cacheWrite: number; // 5-minute cache write
  cacheRead: number;
  output: number;
}

// Opus 4 / 4.1 — original pricing tier
const OPUS_4_RATE: ModelRate = {
  input: 15,
  cacheWrite: 18.75,
  cacheRead: 1.5,
  output: 75,
};

// Opus 4.5 / 4.6 / 4.7 — 3× cheaper than Opus 4
const OPUS_45_RATE: ModelRate = {
  input: 5,
  cacheWrite: 6.25,
  cacheRead: 0.5,
  output: 25,
};

// Sonnet 4 / 4.5 / 4.6 (and 3.7) — all share the same rate
const SONNET_RATE: ModelRate = {
  input: 3,
  cacheWrite: 3.75,
  cacheRead: 0.3,
  output: 15,
};

// Haiku 4.5
const HAIKU_45_RATE: ModelRate = {
  input: 1,
  cacheWrite: 1.25,
  cacheRead: 0.1,
  output: 5,
};

// Haiku 3.5 (legacy)
const HAIKU_35_RATE: ModelRate = {
  input: 0.8,
  cacheWrite: 1.0,
  cacheRead: 0.08,
  output: 4,
};

function rateFor(model?: string): ModelRate | null {
  if (!model) return null;
  const m = model.toLowerCase();

  if (m.includes('opus')) {
    // Opus 4.5+ uses the new lower rate; Opus 4 / 4.1 / 3 use the original.
    if (/opus-4-([5-9]|1\d)/.test(m) || /opus-[5-9]/.test(m)) return OPUS_45_RATE;
    return OPUS_4_RATE;
  }

  if (m.includes('sonnet')) return SONNET_RATE;

  if (m.includes('haiku')) {
    if (/haiku-3-5/.test(m)) return HAIKU_35_RATE;
    return HAIKU_45_RATE;
  }

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
