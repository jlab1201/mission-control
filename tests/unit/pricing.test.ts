import { describe, it, expect } from 'vitest';
import { costForUsage } from '@/server/pricing';

const MTOK = 1_000_000;

describe('costForUsage', () => {
  describe('Opus 4 / 4.1 (legacy rate)', () => {
    it('charges $15/MTok input, $75/MTok output for opus-4', () => {
      const cost = costForUsage('claude-opus-4-20250514', {
        input_tokens: MTOK,
        output_tokens: MTOK,
      });
      expect(cost).toBeCloseTo(15 + 75, 6);
    });

    it('also applies legacy rate to opus-4-1', () => {
      const cost = costForUsage('claude-opus-4-1-20250805', {
        input_tokens: MTOK,
      });
      expect(cost).toBeCloseTo(15, 6);
    });

    it('applies $18.75 cache write and $1.50 cache read', () => {
      const cost = costForUsage('claude-opus-4', {
        cache_creation_input_tokens: MTOK,
        cache_read_input_tokens: MTOK,
      });
      expect(cost).toBeCloseTo(18.75 + 1.5, 6);
    });
  });

  describe('Opus 4.5+ (current rate, 3x cheaper)', () => {
    it('charges $5/MTok input, $25/MTok output for opus-4-5', () => {
      const cost = costForUsage('claude-opus-4-5-20250828', {
        input_tokens: MTOK,
        output_tokens: MTOK,
      });
      expect(cost).toBeCloseTo(5 + 25, 6);
    });

    it('applies new rate to opus-4-6 and opus-4-7', () => {
      const c46 = costForUsage('claude-opus-4-6', { output_tokens: MTOK });
      const c47 = costForUsage('claude-opus-4-7', { output_tokens: MTOK });
      expect(c46).toBeCloseTo(25, 6);
      expect(c47).toBeCloseTo(25, 6);
    });

    it('applies $6.25 cache write and $0.50 cache read for opus 4.5+', () => {
      const cost = costForUsage('claude-opus-4-7', {
        cache_creation_input_tokens: MTOK,
        cache_read_input_tokens: MTOK,
      });
      expect(cost).toBeCloseTo(6.25 + 0.5, 6);
    });
  });

  describe('Sonnet (uniform rate across 4.x)', () => {
    it('charges $3/MTok input, $15/MTok output', () => {
      const cost = costForUsage('claude-sonnet-4-6', {
        input_tokens: MTOK,
        output_tokens: MTOK,
      });
      expect(cost).toBeCloseTo(3 + 15, 6);
    });

    it('applies same rate to sonnet-4, 4.5, 4.6', () => {
      const a = costForUsage('claude-sonnet-4', { input_tokens: MTOK });
      const b = costForUsage('claude-sonnet-4-5', { input_tokens: MTOK });
      const c = costForUsage('claude-sonnet-4-6', { input_tokens: MTOK });
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(a).toBeCloseTo(3, 6);
    });

    it('cache write $3.75, cache read $0.30', () => {
      const cost = costForUsage('claude-sonnet-4-6', {
        cache_creation_input_tokens: MTOK,
        cache_read_input_tokens: MTOK,
      });
      expect(cost).toBeCloseTo(3.75 + 0.3, 6);
    });
  });

  describe('Haiku', () => {
    it('Haiku 4.5: $1/MTok input, $5/MTok output, $0.10 cache read', () => {
      const cost = costForUsage('claude-haiku-4-5-20251001', {
        input_tokens: MTOK,
        output_tokens: MTOK,
        cache_read_input_tokens: MTOK,
      });
      expect(cost).toBeCloseTo(1 + 5 + 0.1, 6);
    });

    it('Haiku 3.5: $0.80/MTok input, $4/MTok output, $0.08 cache read', () => {
      const cost = costForUsage('claude-haiku-3-5-20241022', {
        input_tokens: MTOK,
        output_tokens: MTOK,
        cache_read_input_tokens: MTOK,
      });
      expect(cost).toBeCloseTo(0.8 + 4 + 0.08, 6);
    });
  });

  describe('model matching', () => {
    it('is case-insensitive', () => {
      const lower = costForUsage('claude-sonnet-4-6', { output_tokens: MTOK });
      const upper = costForUsage('Claude-Sonnet-4-6', { output_tokens: MTOK });
      const mixed = costForUsage('CLAUDE-SONNET-4-6', { output_tokens: MTOK });
      expect(lower).toBe(upper);
      expect(upper).toBe(mixed);
    });

    it('returns 0 for unknown / non-Claude models', () => {
      expect(costForUsage('gpt-4', { input_tokens: MTOK })).toBe(0);
      expect(costForUsage('gemini-pro', { input_tokens: MTOK })).toBe(0);
      expect(costForUsage('llama-3', { input_tokens: MTOK })).toBe(0);
    });

    it('returns 0 when model is undefined', () => {
      expect(costForUsage(undefined, { input_tokens: MTOK })).toBe(0);
    });
  });

  describe('usage edge cases', () => {
    it('returns 0 for empty usage', () => {
      expect(costForUsage('claude-sonnet-4-6', {})).toBe(0);
    });

    it('treats missing fields as 0', () => {
      const cost = costForUsage('claude-sonnet-4-6', { output_tokens: MTOK });
      expect(cost).toBeCloseTo(15, 6);
    });

    it('divides by 1M correctly for sub-million counts', () => {
      const cost = costForUsage('claude-sonnet-4-6', {
        input_tokens: 1000,
        output_tokens: 500,
      });
      expect(cost).toBeCloseTo((1000 * 3 + 500 * 15) / 1_000_000, 9);
    });

    it('sums all four token categories', () => {
      const cost = costForUsage('claude-sonnet-4-6', {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 400,
      });
      const expected =
        (100 * 3 + 200 * 15 + 300 * 3.75 + 400 * 0.3) / 1_000_000;
      expect(cost).toBeCloseTo(expected, 9);
    });
  });
});
