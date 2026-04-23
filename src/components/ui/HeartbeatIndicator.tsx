'use client';

import { useEffect, useState } from 'react';

interface HeartbeatIndicatorProps {
  lastEventAt?: string;
  sseStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
}

function getAgeSeconds(lastEventAt?: string): number {
  if (!lastEventAt) return Infinity;
  return (Date.now() - new Date(lastEventAt).getTime()) / 1000;
}

type Freshness = 'fresh' | 'stale' | 'dead';

function computeFreshness(
  sseStatus: HeartbeatIndicatorProps['sseStatus'],
  ageSeconds: number,
): Freshness {
  if (sseStatus === 'disconnected') return 'dead';
  if (ageSeconds < 5) return 'fresh';
  if (ageSeconds < 15) return 'stale';
  return 'dead';
}

const FRESHNESS_CONFIG: Record<
  Freshness,
  { colorVar: string; pulse: string; label: string }
> = {
  fresh: { colorVar: 'var(--success)', pulse: 'pulse-green', label: 'live' },
  stale: { colorVar: 'var(--warning)', pulse: 'pulse-amber', label: 'slow' },
  dead: { colorVar: 'var(--danger)', pulse: 'pulse-red', label: 'stale' },
};

export function HeartbeatIndicator({
  lastEventAt,
  sseStatus,
}: HeartbeatIndicatorProps) {
  const [ageSeconds, setAgeSeconds] = useState(() => getAgeSeconds(lastEventAt));

  useEffect(() => {
    setAgeSeconds(getAgeSeconds(lastEventAt));
    const interval = setInterval(() => {
      setAgeSeconds(getAgeSeconds(lastEventAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastEventAt]);

  const freshness = computeFreshness(sseStatus, ageSeconds);
  const config = FRESHNESS_CONFIG[freshness];

  const ageLabel =
    ageSeconds === Infinity
      ? 'no events'
      : ageSeconds < 60
      ? `${Math.floor(ageSeconds)}s ago`
      : `${Math.floor(ageSeconds / 60)}m ago`;

  return (
    <div
      className="flex items-center gap-1.5"
      role="status"
      aria-label={`Connection freshness: ${freshness}, ${ageLabel}`}
    >
      <div
        className={`w-2 h-2 rounded-full ${config.pulse}`}
        style={{ backgroundColor: config.colorVar }}
      />
      <span
        className="font-mono text-xs"
        style={{ color: config.colorVar, letterSpacing: '0.05em' }}
      >
        {config.label} · {ageLabel}
      </span>
    </div>
  );
}
