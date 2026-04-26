'use client';

import { useEffect, useState } from 'react';

/**
 * Returns a formatted accumulated work-duration string (e.g. "1h02m",
 * "5m30s", "42s") given the persisted accumulator and the current active
 * streak start.
 *
 * - When `activeStreakStart` is non-null, ticks every second showing
 *   `workDurationMs + (now - activeStreakStart)`.
 * - When `activeStreakStart` is null, the value is frozen at
 *   `workDurationMs` — no interval is scheduled, no re-renders.
 *
 * Returns "—" when the accumulator is zero AND no streak is active (a
 * never-yet-worked agent, or a still-empty mission).
 */
export function useWorkDuration(
  workDurationMs: number,
  activeStreakStart: string | null | undefined,
): string {
  const isLive = !!activeStreakStart;

  const compute = (): number => {
    if (!isLive) return Math.max(0, workDurationMs);
    const startMs = new Date(activeStreakStart!).getTime();
    if (Number.isNaN(startMs)) return Math.max(0, workDurationMs);
    return Math.max(0, workDurationMs + (Date.now() - startMs));
  };

  const [ms, setMs] = useState<number>(compute);

  useEffect(() => {
    setMs(compute());
    if (!isLive) return;
    const id = setInterval(() => setMs(compute()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workDurationMs, activeStreakStart]);

  if (ms <= 0 && !isLive) return '—';
  return formatDuration(ms);
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
