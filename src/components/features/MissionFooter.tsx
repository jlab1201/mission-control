'use client';

import { useShallow } from 'zustand/react/shallow';
import { HeartbeatIndicator } from '@/components/ui/HeartbeatIndicator';
import { useMissionStore, selectFilteredAgents } from '@/lib/store/missionStore';
import { useWorkDuration } from '@/hooks/useWorkDuration';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

export function MissionFooter() {
  const agents = useMissionStore(useShallow(selectFilteredAgents));
  const sseStatus = useMissionStore((s) => s.sseStatus);
  const lastEventReceivedAt = useMissionStore((s) => s.lastEventReceivedAt);
  const missionWorkDurationMs = useMissionStore(
    (s) => s.stats?.missionWorkDurationMs ?? 0,
  );
  const missionActiveSince = useMissionStore(
    (s) => s.stats?.missionActiveSince ?? null,
  );

  const totalTokens = agents.reduce(
    (sum, a) =>
      sum +
      (a.tokensIn ?? 0) +
      (a.tokensOut ?? 0) +
      (a.cacheCreateTokens ?? 0) +
      (a.cacheReadTokens ?? 0),
    0,
  );
  const totalCost = agents.reduce((sum, a) => sum + (a.estCostUsd ?? 0), 0);
  const duration = useWorkDuration(missionWorkDurationMs, missionActiveSince);

  return (
    <footer
      className="h-[36px] flex items-center justify-start gap-5 px-6 border-t flex-shrink-0"
      style={{
        backgroundColor: 'var(--background)',
        borderTopColor: 'var(--border)',
        zIndex: 40,
      }}
      role="contentinfo"
    >
      <Stat
        label="duration"
        value={duration}
        title="Total time at least one agent was active. Pauses when every agent is idle/completed; never resets — accumulates across status flips and persists across MC restarts."
      />
      <Separator />
      <Stat
        label="tokens"
        value={formatTokens(totalTokens)}
        title={`${totalTokens.toLocaleString()} total tokens (input + output + cache)`}
      />
      <Separator />
      <Stat
        label="est cost"
        value={formatCost(totalCost)}
        highlight
        title="Estimated USD cost · based on published Anthropic pricing"
      />
      <Separator />
      <HeartbeatIndicator
        lastEventAt={lastEventReceivedAt ?? undefined}
        sseStatus={sseStatus}
      />
    </footer>
  );
}

function Stat({
  label,
  value,
  highlight = false,
  title,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <span
        className="font-mono text-[9px] uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </span>
      <span
        className="font-mono"
        style={{
          color: highlight ? 'var(--accent-primary)' : 'var(--foreground)',
          fontSize: '11px',
          textShadow: highlight
            ? '0 0 8px color-mix(in srgb, var(--accent-primary) 50%, transparent)'
            : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Separator() {
  return (
    <div
      className="w-px h-4"
      style={{ backgroundColor: 'var(--border)' }}
    />
  );
}
