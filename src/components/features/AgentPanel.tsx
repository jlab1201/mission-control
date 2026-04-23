'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Agent, AgentDefinition } from '@/types';
import { useElapsed } from '@/hooks/useElapsed';
import { watchAgent } from '@/lib/api/agents';
import { AgentPopover } from './AgentPopover';
import { HostBadge } from '@/components/features/HostBadge';
import { useMissionStore, selectFilteredAgents, selectHosts } from '@/lib/store/missionStore';

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  idle: 1,
  dormant: 2,
  completed: 3,
  failed: 3,
};

const CLOSE_GRACE_MS = 500;

/**
 * A rail entry may be backed by a live Agent, a definition-only dormant entry,
 * or both (definition matched to a live agent).
 */
interface RailEntry {
  key: string;
  name: string;
  role: string;
  color?: string;
  live: Agent | null;
  status: 'active' | 'idle' | 'dormant' | 'completed' | 'failed';
}

interface AgentPanelProps {
  agents: Agent[];
  definitions: AgentDefinition[];
}

export function AgentPanel({ agents: agentsProp, definitions }: AgentPanelProps) {
  const filteredAgents = useMissionStore(useShallow(selectFilteredAgents));
  const hosts = useMissionStore(useShallow(selectHosts));
  const multiHost = hosts.length > 1;

  // Use filtered agents from the store; fall back to prop during initial hydration.
  const agents = filteredAgents.length > 0 ? filteredAgents : agentsProp;

  const main = agents.find((a) => a.id === 'main');

  // team-lead definition folds into the `main` card — it's the role the user's
  // own session plays, not a separate agent that ever gets spawned.
  const teamLeadDef = definitions.find(
    (d) => d.name.toLowerCase() === 'team-lead',
  );
  const otherDefinitions = definitions.filter(
    (d) => d.name.toLowerCase() !== 'team-lead',
  );

  const isLiveStatus = (a: Agent) =>
    a.status === 'active' || a.status === 'idle';

  // Claim subagents by team-role definition — e.g., any subagent whose
  // name/subagentType is "frontend-dev" belongs to the frontend-dev rail card,
  // NOT to main/team-lead's subagent flyout. Completed/failed subagents are
  // claimed too (so they stay off main's flyout) but don't appear in the list.
  const subsByDef: Record<string, Agent[]> = {};
  const claimedSubIds = new Set<string>();
  for (const def of otherDefinitions) {
    const matches = agents.filter(
      (a) =>
        a.type === 'subagent' &&
        (a.name === def.name || a.subagentType === def.name),
    );
    const liveMatches = matches.filter(isLiveStatus);
    if (liveMatches.length > 0) subsByDef[def.name] = liveMatches;
    for (const s of matches) claimedSubIds.add(s.id);
  }

  // Remaining (ad-hoc) live subagents bucketed by parent — shown on main's flyout
  const orphanSubsByParent: Record<string, Agent[]> = {};
  for (const a of agents) {
    if (a.type !== 'subagent') continue;
    if (claimedSubIds.has(a.id)) continue;
    if (!isLiveStatus(a)) continue;
    const key = a.parentAgentId ?? 'main';
    (orphanSubsByParent[key] ??= []).push(a);
  }

  const entries: RailEntry[] = [];

  entries.push({
    key: 'main',
    name: 'team-lead',
    role: teamLeadDef?.role ?? 'user session — orchestrator',
    color: teamLeadDef?.color ?? main?.color,
    live: main ?? null,
    status: main ? (main.status === 'active' ? 'active' : 'idle') : 'dormant',
  });

  for (const def of otherDefinitions) {
    const matching = agents.filter(
      (a) => a.name === def.name || a.subagentType === def.name,
    );
    // Prefer an active run; fall back to any live run; then any match at all.
    const liveMatch =
      matching.find((a) => a.type !== 'subagent' && a.status === 'active') ??
      matching.find((a) => a.status === 'active') ??
      matching.find((a) => a.type !== 'subagent' && isLiveStatus(a)) ??
      matching.find(isLiveStatus) ??
      matching[0] ??
      null;
    entries.push({
      key: `def:${def.name}`,
      name: def.name,
      role: def.role,
      color: def.color ?? liveMatch?.color,
      live: liveMatch,
      status: liveMatch
        ? liveMatch.status === 'active'
          ? 'active'
          : 'idle'
        : 'dormant',
    });
  }

  entries.sort((a, b) => {
    if (a.key === 'main') return -1;
    if (b.key === 'main') return 1;
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  // ── Single-flyout controller (lifted here so only one card's flyout shows) ──
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    cancelClose();
    setActiveKey(null);
    setPinned(false);
  }, [cancelClose]);

  const handleCardEnter = useCallback(
    (key: string) => {
      cancelClose();
      // Hovering a new card overrides any pinned state (user wants single-at-a-time)
      setActiveKey((prev) => {
        if (prev !== null && prev !== key) {
          // Switching cards — drop pin if it was on the previous one
          setPinned(false);
        }
        return key;
      });
    },
    [cancelClose],
  );

  const handleCardLeave = useCallback(() => {
    cancelClose();
    // Pinned flyouts survive mouse-leave
    if (pinned) return;
    closeTimerRef.current = setTimeout(() => {
      setActiveKey(null);
    }, CLOSE_GRACE_MS);
  }, [cancelClose, pinned]);

  const handleCardClick = useCallback(
    (key: string) => {
      cancelClose();
      setActiveKey((prev) => {
        if (prev === key && pinned) {
          // Clicking a pinned card again toggles it off
          setPinned(false);
          return null;
        }
        setPinned(true);
        return key;
      });
    },
    [cancelClose, pinned],
  );

  // Global Esc to dismiss the flyout (whether pinned or just hovered)
  useEffect(() => {
    if (activeKey === null && !pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeKey, pinned, dismiss]);

  // Cleanup any pending timer on unmount
  useEffect(() => {
    return () => cancelClose();
  }, [cancelClose]);

  return (
    <aside
      className="border-r flex flex-col flex-shrink-0 h-full"
      style={{
        borderRightColor: 'var(--border)',
        backgroundColor: 'var(--background)',
      }}
      aria-label="Agents"
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
        style={{ borderBottomColor: 'var(--border)' }}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-widest font-bold"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.18em' }}
        >
          Agents
        </span>
        <span
          className="font-mono text-[10px]"
          style={{ color: 'var(--text-muted)' }}
        >
          {entries.length}
        </span>
      </div>

      <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
        {entries.map((entry) => {
          const isOpen = activeKey === entry.key;
          // Main/team-lead → ad-hoc subagents only (role-matched ones belong
          // to their own team card). Team cards → claimed subagents for that role.
          const flyoutSubs =
            entry.key === 'main'
              ? orphanSubsByParent['main'] ?? []
              : subsByDef[entry.name] ?? [];
          return (
            <AgentRailCard
              key={entry.key}
              entry={entry}
              isOpen={isOpen}
              isPinned={isOpen && pinned}
              subagents={flyoutSubs}
              multiHost={multiHost}
              onEnter={() => handleCardEnter(entry.key)}
              onLeave={handleCardLeave}
              onClick={() => handleCardClick(entry.key)}
              onDismiss={dismiss}
            />
          );
        })}
      </div>
    </aside>
  );
}

interface AgentRailCardProps {
  entry: RailEntry;
  isOpen: boolean;
  isPinned: boolean;
  subagents: Agent[];
  multiHost: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
  onDismiss: () => void;
}

function AgentRailCard({
  entry,
  isOpen,
  isPinned,
  subagents,
  multiHost,
  onEnter,
  onLeave,
  onClick,
  onDismiss,
}: AgentRailCardProps) {
  const elapsed = useElapsed(
    entry.live?.startedAt,
    entry.status === 'active',
    entry.live?.lastActiveAt,
  );
  const [watching, setWatching] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState('');
  const cardRef = useRef<HTMLDivElement | null>(null);

  const isActive = entry.status === 'active';
  const isDormant = entry.status === 'dormant';
  const color = entry.color ?? 'var(--accent-primary)';
  const canWatch = !!entry.live && !!entry.live.transcriptPath;

  const handleWatch = async () => {
    if (!entry.live) return;
    setWatching('loading');
    setErrorMsg('');
    try {
      await watchAgent(entry.live.id);
      setWatching('done');
      setTimeout(() => setWatching('idle'), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
      setWatching('error');
      setTimeout(() => setWatching('idle'), 4000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className="relative"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        ref={cardRef}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${entry.name} — ${isOpen ? 'hide' : 'show'} subagents`}
        className={`lab-panel glow-hover w-full text-left relative flex flex-col ${isActive ? 'agent-working-ring' : ''}`}
        style={{
          padding: '10px 12px',
          borderLeft: `3px solid ${isActive ? color : 'var(--border)'}`,
          transition: 'border-color 0.3s ease, box-shadow 180ms ease',
          cursor: 'pointer',
        }}
      >
        {/* Top row: dot · name (left) · runtime · watch (right) */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'pulse-green' : ''}`}
              style={{
                backgroundColor: isActive
                  ? color
                  : isDormant
                    ? 'transparent'
                    : 'var(--border-strong)',
                border: isDormant ? '1px solid var(--border-strong)' : 'none',
              }}
            />
            <span
              className="font-mono text-xs font-bold truncate"
              style={{ color: 'var(--foreground)' }}
              title={entry.name}
            >
              {entry.name}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className="font-mono text-[10px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {entry.live ? elapsed : 'dormant'}
            </span>
            {canWatch && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleWatch();
                }}
                disabled={watching === 'loading'}
                className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-all duration-200"
                style={{
                  backgroundColor:
                    watching === 'done'
                      ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                      : watching === 'error'
                        ? 'color-mix(in srgb, var(--danger) 15%, transparent)'
                        : 'color-mix(in srgb, var(--accent-primary) 8%, transparent)',
                  color:
                    watching === 'done'
                      ? 'var(--success)'
                      : watching === 'error'
                        ? 'var(--danger)'
                        : 'var(--accent-primary)',
                  border: `1px solid ${
                    watching === 'done'
                      ? 'color-mix(in srgb, var(--success) 30%, transparent)'
                      : watching === 'error'
                        ? 'color-mix(in srgb, var(--danger) 30%, transparent)'
                        : 'color-mix(in srgb, var(--accent-primary) 20%, transparent)'
                  }`,
                  cursor: watching === 'loading' ? 'wait' : 'pointer',
                }}
                title={
                  watching === 'error' ? errorMsg : 'Open tmux window tailing transcript'
                }
              >
                {watching === 'loading'
                  ? '...'
                  : watching === 'done'
                    ? 'opened'
                    : watching === 'error'
                      ? 'err'
                      : 'watch'}
              </button>
            )}
          </div>
        </div>

        {/* Second row: role + host badge */}
        {(entry.role || (multiHost && !!entry.live)) && (
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {entry.role && (
              <span
                className="font-mono text-[10px] truncate"
                style={{ color: 'var(--text-muted)', letterSpacing: '0.02em' }}
                title={entry.role}
              >
                {entry.role}
              </span>
            )}
            {multiHost && entry.live && (
              <HostBadge
                hostId={entry.live.hostId}
                hostLabel={entry.live.hostLabel}
                compact
              />
            )}
          </div>
        )}
      </div>

      {isOpen && cardRef.current && (
        <AgentPopover
          anchor={cardRef.current}
          subagents={subagents}
          pinned={isPinned}
          onDismiss={onDismiss}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        />
      )}
    </div>
  );
}

