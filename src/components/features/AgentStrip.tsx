'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PhaseIndicator } from '@/components/ui/PhaseIndicator';
import { ActivitySparkline } from '@/components/ui/ActivitySparkline';
import { HostBadge } from '@/components/features/HostBadge';
import type { Agent } from '@/types';
import { useElapsed } from '@/hooks/useElapsed';
import { watchAgent } from '@/lib/api/agents';
import { shortRole } from '@/lib/utils';
import { agentColor } from '@/lib/constants/agentColors';
import { useMissionStore, selectFilteredAgents, selectHosts } from '@/lib/store/missionStore';

interface AgentStripProps {
  agents: Agent[];
}

interface AgentCardProps {
  agent: Agent;
  multiHost: boolean;
}

function AgentCard({ agent, multiHost }: AgentCardProps) {
  const [watching, setWatching] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const isTeam = agent.type === 'team';
  const isActive = agent.status === 'active';
  const elapsed = useElapsed(agent.startedAt, isActive, agent.lastActiveAt);
  const isIdle = agent.status === 'idle';
  // Resolve color the same way TaskCard does: agent.color override, then the
  // shared role palette keyed by subagentType (specialist subagents) or name
  // (team agents and main). Keeps the strip card color in sync with the
  // owner-tinted task cards on the kanban.
  const color = agent.color ?? agentColor(agent.subagentType ?? agent.name);

  const ownRole = agent.subagentType ?? agent.name;
  const displayName =
    agent.type === 'main'
      ? 'main'
      : isTeam
        ? agent.name
        : `${shortRole(agent.parentAgentLabel ?? 'main')}>sub:${shortRole(ownRole) || ownRole}`;

  const lastAction = agent.lastAction
    ? agent.lastAction.length > 34
      ? agent.lastAction.slice(0, 34) + '…'
      : agent.lastAction
    : '—';

  const handleWatch = async () => {
    setWatching('loading');
    setErrorMsg('');
    try {
      await watchAgent(agent.id);
      setWatching('done');
      setTimeout(() => setWatching('idle'), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
      setWatching('error');
      setTimeout(() => setWatching('idle'), 4000);
    }
  };

  return (
    <div
      className={`lab-panel glow-hover relative flex-shrink-0 flex flex-col justify-between ${isActive ? 'agent-working-ring' : ''}`}
      style={{
        width: '260px',
        minHeight: '88px',
        padding: '10px 12px 8px 14px',
        borderLeft: `3px solid ${isActive ? color : 'var(--border)'}`,
        opacity: isIdle ? 0.65 : 1,
        transition: 'opacity 0.3s ease, border-color 0.3s ease, box-shadow 180ms ease',
      }}
    >
      {/* Top row: name + phase + elapsed */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Status dot */}
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'pulse-green' : ''}`}
            style={{
              backgroundColor: isActive ? color : 'var(--border-strong)',
            }}
          />
          <span
            className="font-mono text-xs font-bold truncate"
            style={{
              color: isActive ? 'var(--foreground)' : 'var(--text-muted)',
              maxWidth: '170px',
            }}
            title={`${displayName}${agent.description ? ` — ${agent.description}` : ''}`}
          >
            {displayName}
          </span>
        </div>
        <span
          className="font-mono text-[10px] flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
          {elapsed}
        </span>
      </div>

      {/* Phase indicator + host badge (hidden for team cards — phase is n/a) */}
      {!isTeam && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <PhaseIndicator phase={agent.phase} color={color} />
          {multiHost && (
            <HostBadge hostId={agent.hostId} hostLabel={agent.hostLabel} compact />
          )}
        </div>
      )}

      {/* Last action (or role label for team cards) */}
      <div className="mt-1.5">
        <span
          className="font-mono text-[10px] block"
          style={{ color: 'var(--text-muted)' }}
          title={agent.lastAction}
        >
          {isTeam ? 'team · ownership only' : lastAction}
        </span>
      </div>

      {/* Bottom row: sparkline + watch button (both hidden for team cards) */}
      {!isTeam && (
      <div className="flex items-center justify-between mt-2">
        <ActivitySparkline timestamps={agent.recentToolUseTimestamps} width={100} height={14} />
        <button
          onClick={handleWatch}
          disabled={watching === 'loading'}
          className="font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded transition-all duration-200"
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
          title={watching === 'error' ? errorMsg : 'Open tmux window tailing transcript'}
        >
          {watching === 'loading'
            ? '...'
            : watching === 'done'
            ? 'opened'
            : watching === 'error'
            ? 'error'
            : 'watch ▶'}
        </button>
      </div>
      )}
      {!isTeam && watching === 'error' && errorMsg && (
        <div
          className="mt-1.5 font-mono text-[10px] leading-snug rounded px-2 py-1"
          style={{
            color: 'var(--danger)',
            backgroundColor: 'color-mix(in srgb, var(--danger) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
          }}
          role="alert"
        >
          {errorMsg}
        </div>
      )}
    </div>
  );
}

export function AgentStrip({ agents: agentsProp }: AgentStripProps) {
  const [showHistory, setShowHistory] = useState(false);
  const filteredAgents = useMissionStore(useShallow(selectFilteredAgents));
  const hosts = useMissionStore(useShallow(selectHosts));

  // Use filtered agents from the store; fall back to prop if store is empty
  // (e.g., when AgentStrip is rendered before the store has hydrated).
  const agents = filteredAgents.length > 0 ? filteredAgents : agentsProp;
  const multiHost = hosts.length > 1;

  const visible = showHistory
    ? agents
    : agents.filter((a) => a.status === 'active' || a.status === 'idle');

  if (agents.length === 0) return null;

  return (
    <div
      className="w-full border-b"
      style={{
        borderBottomColor: 'var(--border)',
        backgroundColor: 'var(--background)',
      }}
    >
      <div className="flex items-center gap-3 px-6 py-3 overflow-x-auto">
        <div id="agent-strip-list" className="flex items-center gap-3 flex-shrink-0">
          {visible.map((agent) => (
            <AgentCard key={agent.id} agent={agent} multiHost={multiHost} />
          ))}
        </div>

        {/* Show history toggle */}
        <button
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          aria-controls="agent-strip-list"
          className="glow-hover flex-shrink-0 font-mono text-[9px] uppercase tracking-widest px-3 py-1 rounded transition-all duration-200 self-center"
          style={{
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            backgroundColor: 'transparent',
            whiteSpace: 'nowrap',
          }}
        >
          {showHistory ? 'hide history' : `show history (${agents.filter((a) => a.status === 'completed' || a.status === 'failed').length})`}
        </button>
      </div>
    </div>
  );
}
