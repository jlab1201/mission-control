interface HostBadgeProps {
  hostId: string;
  hostLabel?: string;
  compact?: boolean;
}

/**
 * Tiny host pill shown on agent cards.
 * Matches the phase-pill style from AgentStrip (font-mono, text-[9px], uppercase, tracking-wider,
 * px-2 py-0.5, rounded, with accent-primary tint).
 * Returns null when hostId is empty/undefined — safe to render unconditionally.
 */
export function HostBadge({ hostId, hostLabel, compact = false }: HostBadgeProps) {
  if (!hostId) return null;

  const label = hostLabel ?? hostId;

  return (
    <span
      className={`font-mono uppercase tracking-wider rounded flex-shrink-0 ${
        compact ? 'text-[8px] px-1.5 py-px' : 'text-[9px] px-2 py-0.5'
      }`}
      style={{
        backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
        color: 'var(--accent-primary)',
        border: '1px solid color-mix(in srgb, var(--accent-primary) 22%, transparent)',
      }}
      title={`Host: ${label}`}
    >
      {label}
    </span>
  );
}
