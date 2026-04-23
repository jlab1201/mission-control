'use client';

import { useMissionStore } from '@/lib/store/missionStore';

export function SseStatusIndicator() {
  const sseStatus = useMissionStore((s) => s.sseStatus);

  const config = {
    connected: { colorVar: 'var(--success)', label: 'LIVE', pulse: 'pulse-green' },
    connecting: { colorVar: 'var(--accent-secondary)', label: 'CONNECTING', pulse: 'pulse-amber' },
    reconnecting: { colorVar: 'var(--warning)', label: 'RECONNECTING', pulse: 'pulse-amber' },
    disconnected: { colorVar: 'var(--danger)', label: 'OFFLINE', pulse: 'pulse-red' },
  }[sseStatus];

  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-2 h-2 rounded-full ${config.pulse}`}
        style={{ backgroundColor: config.colorVar }}
      />
      <span className="font-mono text-xs tracking-widest" style={{ color: config.colorVar }}>
        {config.label}
      </span>
    </div>
  );
}
