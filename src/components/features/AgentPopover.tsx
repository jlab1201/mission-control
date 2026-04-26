'use client';

import { useLayoutEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { createPortal } from 'react-dom';
import type { Agent } from '@/types';
import { useElapsed } from '@/hooks/useElapsed';
import { shortRole } from '@/lib/utils';
import { agentColor } from '@/lib/constants/agentColors';
import { HostBadge } from '@/components/features/HostBadge';
import { useMissionStore, selectHosts } from '@/lib/store/missionStore';

const FLYOUT_WIDTH = 300;

export interface AgentPopoverProps {
  anchor: HTMLElement;
  subagents: Agent[];
  pinned: boolean;
  onDismiss: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function AgentPopover({
  anchor,
  subagents,
  pinned,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}: AgentPopoverProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const preferredLeft = rect.right + 8;
      const overflow = preferredLeft + FLYOUT_WIDTH - window.innerWidth;
      const left =
        overflow > 0 ? Math.max(8, rect.left - FLYOUT_WIDTH - 8) : preferredLeft;
      setPos({ top: rect.top, left });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);

  if (!pos) return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="Subagents"
      className="fixed"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        width: `${FLYOUT_WIDTH}px`,
        maxHeight: '340px',
        overflowY: 'auto',
        zIndex: 70,
        backgroundColor: 'var(--surface-elevated)',
        border: '1px solid var(--border-strong)',
        borderRadius: '6px',
        boxShadow:
          '0 12px 32px -8px color-mix(in srgb, var(--foreground) 35%, transparent)',
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b sticky top-0"
        style={{
          borderBottomColor: 'var(--border)',
          backgroundColor: 'var(--surface-elevated)',
        }}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-widest font-bold"
          style={{ color: 'var(--accent-primary)', letterSpacing: '0.15em' }}
        >
          subagents · {subagents.length}
          {pinned && (
            <span
              className="ml-2 font-mono text-[9px]"
              style={{ color: 'var(--text-muted)' }}
              title="Pinned — click X to close"
            >
              · pinned
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close (Esc)"
          title="Close (Esc)"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '11px',
            lineHeight: '1',
            transition: 'color 120ms ease, border-color 120ms ease, background 120ms ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--danger)';
            (e.currentTarget as HTMLButtonElement).style.background =
              'color-mix(in srgb, var(--danger) 8%, transparent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          ✕
        </button>
      </div>

      {subagents.length === 0 ? (
        <div
          className="font-mono text-[10px] px-3 py-4 text-center"
          style={{ color: 'var(--text-muted)' }}
        >
          no live subagents
        </div>
      ) : (
        <ul className="flex flex-col">
          {subagents.map((sa) => (
            <SubagentRow key={sa.id} agent={sa} />
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}

function SubagentRow({ agent }: { agent: Agent }) {
  const isActive = agent.status === 'active';
  const elapsed = useElapsed(agent.startedAt, isActive, agent.lastActiveAt);
  const color = agent.color ?? agentColor(agent.subagentType ?? agent.name);
  const label = shortRole(agent.subagentType ?? agent.name) || agent.name;
  const hosts = useMissionStore(useShallow(selectHosts));
  const multiHost = hosts.length > 1;

  return (
    <li
      className="flex items-center justify-between gap-2 px-3 py-2 border-b"
      style={{
        borderBottomColor: 'color-mix(in srgb, var(--border) 50%, transparent)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'pulse-green' : ''}`}
          style={{ backgroundColor: isActive ? color : 'var(--border-strong)' }}
        />
        <span
          className="font-mono text-[11px] font-bold truncate"
          style={{
            color: isActive ? 'var(--foreground)' : 'var(--text-muted)',
          }}
          title={agent.description ?? label}
        >
          {label}
        </span>
        {multiHost && (
          <HostBadge hostId={agent.hostId} hostLabel={agent.hostLabel} compact />
        )}
      </div>
      <span
        className="font-mono text-[9px] flex-shrink-0"
        style={{ color: 'var(--text-muted)' }}
      >
        {elapsed}
      </span>
    </li>
  );
}
