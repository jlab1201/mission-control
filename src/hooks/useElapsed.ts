'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Returns a formatted elapsed-time string (e.g. "1h02m", "5m30s", "42s")
 * that updates every second while `isActive` is true.
 *
 * When `isActive` flips to false the interval stops. If `end` is provided,
 * the frozen value is `end - start` (accurate last-activity duration). If
 * `end` is omitted, the last ticked value is frozen as-is.
 *
 * Pass `null` or `undefined` for `start` to get "—".
 */
export function useElapsed(
  start: Date | string | null | undefined,
  isActive: boolean,
  end?: Date | string | null,
): string {
  const startStr = start instanceof Date ? start.toISOString() : (start ?? null);
  const endStr = end instanceof Date ? end.toISOString() : (end ?? null);

  const computeElapsed = (): number => {
    if (!startStr) return 0;
    const endMs = isActive || !endStr ? Date.now() : new Date(endStr).getTime();
    const diff = Math.floor((endMs - new Date(startStr).getTime()) / 1000);
    return diff > 0 ? diff : 0;
  };

  const [elapsed, setElapsed] = useState<number>(computeElapsed);

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  useEffect(() => {
    if (!startStr) return;

    // Resync immediately on any input change so a fresh `end` (e.g. newer
    // lastActiveAt) takes effect without waiting for the next tick.
    setElapsed(computeElapsed());

    if (isActive) {
      const id = setInterval(() => {
        setElapsed(computeElapsed());
      }, 1000);
      return () => clearInterval(id);
    }
    // isActive is false: no interval, elapsed is frozen at the computed value above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startStr, isActive, endStr]);

  if (!startStr) return '—';
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
