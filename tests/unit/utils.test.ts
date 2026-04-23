import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import {
  formatUptime,
  formatRelativeTime,
  getAgentColor,
  getContextHealthColor,
  getStatusColor,
  cn,
} from '@/lib/utils';

describe('formatUptime', () => {
  it('shows seconds for under a minute', () => {
    expect(formatUptime(45)).toBe('45s');
  });
  it('shows 0 seconds', () => {
    expect(formatUptime(0)).toBe('0s');
  });
  it('shows exactly 1 minute boundary', () => {
    expect(formatUptime(60)).toBe('1m 0s');
  });
  it('shows minutes and seconds', () => {
    expect(formatUptime(125)).toBe('2m 5s');
  });
  it('shows exactly 1 hour boundary', () => {
    expect(formatUptime(3600)).toBe('1h 0m');
  });
  it('shows hours and minutes', () => {
    expect(formatUptime(3661)).toBe('1h 1m');
  });
  it('shows hours only (no seconds) when over 1 hour', () => {
    expect(formatUptime(7322)).toBe('2h 2m');
  });
});

describe('formatRelativeTime', () => {
  const FIXED_NOW = new Date('2026-04-23T10:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows seconds ago for recent times', () => {
    const recent = new Date(FIXED_NOW.getTime() - 5000).toISOString();
    expect(formatRelativeTime(recent)).toBe('5s ago');
  });
  it('shows 0s ago for very recent', () => {
    const recent = new Date(FIXED_NOW.getTime() - 500).toISOString();
    expect(formatRelativeTime(recent)).toBe('0s ago');
  });
  it('shows minutes ago', () => {
    const past = new Date(FIXED_NOW.getTime() - 90000).toISOString();
    expect(formatRelativeTime(past)).toBe('1m ago');
  });
  it('shows hours ago', () => {
    const past = new Date(FIXED_NOW.getTime() - 3700000).toISOString();
    expect(formatRelativeTime(past)).toBe('1h ago');
  });
  it('shows 59m ago just before hour boundary', () => {
    const past = new Date(FIXED_NOW.getTime() - 59 * 60 * 1000).toISOString();
    expect(formatRelativeTime(past)).toBe('59m ago');
  });
});

describe('getAgentColor', () => {
  it('returns correct color for purple', () => {
    expect(getAgentColor('purple')).toBe('#a855f7');
  });
  it('returns correct color for blue', () => {
    expect(getAgentColor('blue')).toBe('#3b82f6');
  });
  it('returns correct color for green', () => {
    expect(getAgentColor('green')).toBe('#22c55e');
  });
  it('returns correct color for orange', () => {
    expect(getAgentColor('orange')).toBe('#f97316');
  });
  it('returns correct color for yellow', () => {
    expect(getAgentColor('yellow')).toBe('#eab308');
  });
  it('returns correct color for red', () => {
    expect(getAgentColor('red')).toBe('#ef4444');
  });
  it('returns correct color for cyan', () => {
    expect(getAgentColor('cyan')).toBe('#06b6d4');
  });
  it('returns fallback for unknown color', () => {
    expect(getAgentColor('unknown')).toBe('#64748b');
  });
  it('returns fallback for empty string', () => {
    expect(getAgentColor('')).toBe('#64748b');
  });
});

describe('getContextHealthColor', () => {
  it('returns neon green for GREEN', () => {
    expect(getContextHealthColor('GREEN')).toBe('#39ff14');
  });
  it('returns amber for YELLOW', () => {
    expect(getContextHealthColor('YELLOW')).toBe('#ffb800');
  });
  it('returns orange for ORANGE', () => {
    expect(getContextHealthColor('ORANGE')).toBe('#f97316');
  });
  it('returns red for RED', () => {
    expect(getContextHealthColor('RED')).toBe('#ff3b5c');
  });
  it('returns fallback for unknown health state', () => {
    expect(getContextHealthColor('CRITICAL')).toBe('#64748b');
  });
});

describe('getStatusColor', () => {
  it('returns neon green for active', () => {
    expect(getStatusColor('active')).toBe('#39ff14');
  });
  it('returns dark grey for idle', () => {
    expect(getStatusColor('idle')).toBe('#4a5568');
  });
  it('returns red for error', () => {
    expect(getStatusColor('error')).toBe('#ff3b5c');
  });
  it('returns amber for compacting', () => {
    expect(getStatusColor('compacting')).toBe('#ffb800');
  });
  it('returns indigo for waiting', () => {
    expect(getStatusColor('waiting')).toBe('#667eea');
  });
  it('returns fallback for unknown status', () => {
    expect(getStatusColor('offline')).toBe('#4a5568');
  });
});

describe('cn (className merger)', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });
  it('handles conditional classes', () => {
    expect(cn('base', false && 'not-included', 'end')).toBe('base end');
  });
  it('resolves tailwind conflicts (last wins)', () => {
    // tailwind-merge: p-2 overrides p-4
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });
  it('handles empty inputs', () => {
    expect(cn()).toBe('');
  });
});
