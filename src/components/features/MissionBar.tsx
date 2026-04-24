'use client';

import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Settings, ChevronDown, X, HelpCircle } from 'lucide-react';
import { SseStatusIndicator } from '@/components/ui/SseStatusIndicator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { WorkspaceSettings } from '@/components/settings/WorkspaceSettings';
import { HelpModal } from '@/components/features/HelpModal';
import { Modal } from '@/components/ui/Modal';
import { APP_NAME } from '@/lib/config/branding';
import { useMissionStore, selectFilteredAgents } from '@/lib/store/missionStore';
import { listProjects, deleteProject } from '@/lib/api/projects';
import type { MissionSnapshot, Task } from '@/types';
import type { RegisteredProjectRow } from '@/types/workspace';

interface MissionBarProps {
  mission: MissionSnapshot['mission'] | null;
  tasks: Task[];
}

export function MissionBar({ mission, tasks }: MissionBarProps) {
  const agents = useMissionStore(useShallow(selectFilteredAgents));
  const { selectedHostId, setSelectedHostId } = useMissionStore(
    useShallow((s) => ({ selectedHostId: s.selectedHostId, setSelectedHostId: s.setSelectedHostId })),
  );
  const mainAgent = agents.find((a) => a.id === 'main');
  const model = mission?.model ?? mainAgent?.model ?? 'unknown';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [hoverTooltip, setHoverTooltip] = useState(false);
  const [projects, setProjects] = useState<RegisteredProjectRow[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derive the button label
  const projectPath = mission?.cwd ?? '';

  let projectLabel = 'no workspace';
  if (selectedHostId) {
    const remoteProject = projects.find((p) => p.hostId === selectedHostId);
    projectLabel = remoteProject?.name ?? selectedHostId;
  } else if (projectPath) {
    projectLabel = projectPath.split('/').filter(Boolean).pop() ?? projectPath;
  }

  const hasProjects = projects.length > 0;

  // Fetch on mount + poll every 5s so hasProjects/dropdown are correct before first click
  useEffect(() => {
    const load = () => { listProjects().then(({ projects: p }) => setProjects(p)).catch(() => {}); };
    load();
    pollRef.current = setInterval(load, 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, []);

  // Close popover on click-outside
  useEffect(() => {
    if (!projectMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [projectMenuOpen]);

  const switchToProject = async (project: RegisteredProjectRow) => {
    if (switching) return;
    setSwitching(project.id);
    try {
      if (project.isLocal) {
        setSelectedHostId(null);
        await fetch('/api/workspace/watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: project.path }),
        });
      } else {
        setSelectedHostId(project.hostId);
      }
    } finally {
      setSwitching(null);
      setProjectMenuOpen(false);
    }
  };

  const forgetProject = (project: RegisteredProjectRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setRemoveTarget({ id: project.id, name: project.name });
  };

  const confirmRemoveProject = async () => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      await deleteProject(removeTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== removeTarget.id));
      setRemoveTarget(null);
    } catch {
      // non-fatal
    } finally {
      setRemoveBusy(false);
    }
  };

  const isActiveProject = (p: RegisteredProjectRow): boolean => {
    if (p.isLocal) return selectedHostId == null && mission?.cwd === p.path;
    return selectedHostId === p.hostId;
  };

  const handleButtonClick = () => {
    if (!hasProjects) return;
    setProjectMenuOpen((v) => !v);
  };

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const agentCount = agents.filter((a) => a.type !== 'subagent').length;
  const subagentCount = agents.filter((a) => a.type === 'subagent').length;

  return (
    <>
    <header
      className="h-[64px] flex items-center justify-between gap-4 px-6 border-b relative"
      style={{
        backgroundColor: 'var(--background)',
        borderBottomColor: 'var(--border)',
        backdropFilter: 'blur(12px)',
        zIndex: 50,
      }}
    >
      {/* Left: Logo + session */}
      <div className="flex items-center gap-4 min-w-0 flex-shrink">
        <div className="flex items-center gap-2">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <polygon
              points="12,2 20,7 20,17 12,22 4,17 4,7"
              stroke="var(--accent-primary)"
              strokeWidth="1.5"
              fill="color-mix(in srgb, var(--accent-primary) 8%, transparent)"
            />
            <polygon
              points="12,6 17,9 17,15 12,18 7,15 7,9"
              stroke="var(--accent-primary)"
              strokeWidth="1"
              fill="color-mix(in srgb, var(--accent-primary) 5%, transparent)"
              strokeOpacity="0.5"
            />
          </svg>
          <span
            className="font-mono text-sm font-bold tracking-widest"
            style={{ color: 'var(--accent-primary)', letterSpacing: '0.15em' }}
          >
            {APP_NAME.toUpperCase()}
          </span>
        </div>
        <div ref={projectMenuRef} className="min-w-0" style={{ position: 'relative' }}>
          <button
            onClick={handleButtonClick}
            onMouseEnter={() => { if (!hasProjects) setHoverTooltip(true); }}
            onMouseLeave={() => setHoverTooltip(false)}
            className="font-mono flex items-center gap-2 px-3 py-1.5 rounded-md transition-all duration-150 max-w-full"
            style={{
              color: projectPath || selectedHostId ? 'var(--accent-primary)' : 'var(--text-muted)',
              backgroundColor: projectPath || selectedHostId
                ? 'color-mix(in srgb, var(--accent-primary) 10%, transparent)'
                : 'transparent',
              border: `1px solid ${projectPath || selectedHostId ? 'color-mix(in srgb, var(--accent-primary) 28%, transparent)' : 'var(--border)'}`,
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              cursor: hasProjects ? 'pointer' : 'default',
            }}
            title={projectPath ? `Watching: ${projectPath}` : selectedHostId ? `Remote: ${selectedHostId}` : 'No workspace configured'}
            aria-label="Current workspace — click to switch"
            aria-expanded={projectMenuOpen}
          >
            <span className="flex-shrink-0" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>›</span>
            <span className="truncate min-w-0">{projectLabel}</span>
            {hasProjects && <ChevronDown size={12} strokeWidth={2} className="flex-shrink-0" style={{ opacity: 0.6 }} />}
          </button>

          {/* Tooltip: shown only when no projects and hovering */}
          {hoverTooltip && !hasProjects && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                zIndex: 60,
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 12px -2px color-mix(in srgb, var(--foreground) 20%, transparent)',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              <span
                className="font-mono text-[11px]"
                style={{ color: 'var(--text-muted)' }}
              >
                Register a project under Settings
              </span>
            </div>
          )}

          {projectMenuOpen && hasProjects && (
            <div
              className="absolute mt-2 rounded-lg overflow-hidden"
              style={{
                top: '100%',
                left: 0,
                minWidth: '300px',
                zIndex: 40,
                padding: '0.25rem',
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border-strong)',
                boxShadow: '0 12px 32px -8px color-mix(in srgb, var(--foreground) 35%, transparent)',
              }}
              role="menu"
            >
              {projects.map((p) => {
                const isActive = isActiveProject(p);
                const isBusy = switching === p.id;
                const hostSuffix = p.hostLabel ? ` · ${p.hostLabel}` : (!p.isLocal ? ` · ${p.hostId}` : '');
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-1 rounded-md transition-all duration-150"
                    style={{
                      backgroundColor: isActive
                        ? 'color-mix(in srgb, var(--accent-primary) 10%, transparent)'
                        : 'transparent',
                    }}
                  >
                    <button
                      onClick={() => { void switchToProject(p); }}
                      disabled={isActive || isBusy}
                      className="flex-1 text-left flex items-center gap-2 px-3 py-2 font-mono transition-all duration-150"
                      style={{
                        color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                        cursor: isActive ? 'default' : 'pointer',
                        fontSize: '12px',
                        background: 'transparent',
                      }}
                      role="menuitem"
                    >
                      {/* Active dot */}
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: isActive ? 'var(--success)' : 'transparent',
                          border: isActive ? 'none' : '1px solid var(--border)',
                          flexShrink: 0,
                        }}
                      />
                      {/* Name + host suffix */}
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <strong>{p.name}</strong>
                        {hostSuffix && (
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{hostSuffix}</span>
                        )}
                      </span>
                      {/* Status dot for non-live remote */}
                      {!p.isLocal && p.hostStatus !== 'live' && (
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: p.hostStatus === 'stale' ? 'var(--warning, #d97706)' : 'var(--text-muted)',
                            flexShrink: 0,
                          }}
                          title={p.hostStatus}
                        />
                      )}
                      {isBusy && <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>…</span>}
                    </button>
                    {!isActive && (
                      <button
                        onClick={(e) => { void forgetProject(p, e); }}
                        className="flex items-center justify-center rounded transition-colors mr-1"
                        style={{
                          width: '22px',
                          height: '22px',
                          color: 'var(--text-muted)',
                          background: 'transparent',
                          flexShrink: 0,
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)';
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'color-mix(in srgb, var(--danger) 10%, transparent)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                        }}
                        title="Remove project"
                        aria-label={`Remove ${p.name}`}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Center: Stats */}
      <div className="flex items-center gap-6 flex-shrink-0">
        <Stat label="model" value={model} mono />
        <Separator />
        <Stat
          label="tasks"
          value={`${completedTasks}/${totalTasks}`}
          mono
          title={`${completedTasks} completed of ${totalTasks} total`}
        />
        <Separator />
        <Stat
          label="agents"
          value={String(agentCount)}
          mono
          title="Main session + any team roles named in TaskCreate that haven't been bound to a real spawned agent yet. Real workers live under 'subagents'."
        />
        <Separator />
        <Stat
          label="subagents"
          value={String(subagentCount)}
          mono
          title="Real subagents spawned via the Agent tool, one per JSONL transcript. Counted by unique agent ID — re-runs of the same agent do not double-count."
        />
      </div>

      {/* Right: SSE + Theme */}
      <div className="flex items-center gap-4 justify-end flex-shrink-0">
        <SseStatusIndicator />
        <ThemeToggle />
        <button
          onClick={() => setHelpOpen(true)}
          aria-label="Help — what do these numbers mean?"
          title="Help — what do these numbers mean?"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2rem',
            height: '2rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'color 120ms ease, border-color 120ms ease, background 120ms ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-primary)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-primary)';
            (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-primary) 8%, transparent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          <HelpCircle size={14} strokeWidth={1.75} />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Open workspace settings"
          title="Workspace settings"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2rem',
            height: '2rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'color 120ms ease, border-color 120ms ease, background 120ms ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-primary)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-primary)';
            (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-primary) 8%, transparent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          <Settings size={14} strokeWidth={1.75} />
        </button>
      </div>
    </header>

    <WorkspaceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    <Modal
      open={!!removeTarget}
      onClose={() => { if (!removeBusy) setRemoveTarget(null); }}
      maxWidth="max-w-md"
      aria-label="Remove registered project"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2
          className="font-mono text-sm font-bold tracking-widest"
          style={{ color: 'var(--foreground)', letterSpacing: '0.1em' }}
        >
          REMOVE PROJECT?
        </h2>
        <p className="font-mono text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Remove <strong style={{ color: 'var(--foreground)' }}>{removeTarget?.name}</strong>{' '}
          from registered projects? The files on disk are not touched — you can register it again later.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => setRemoveTarget(null)}
            disabled={removeBusy}
            className="font-mono text-xs px-3 py-1.5 rounded transition-colors"
            style={{
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
              cursor: removeBusy ? 'not-allowed' : 'pointer',
              opacity: removeBusy ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => { void confirmRemoveProject(); }}
            disabled={removeBusy}
            className="font-mono text-xs px-3 py-1.5 rounded transition-colors"
            style={{
              background: 'color-mix(in srgb, var(--danger) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
              color: 'var(--danger)',
              cursor: removeBusy ? 'not-allowed' : 'pointer',
              opacity: removeBusy ? 0.6 : 1,
            }}
          >
            {removeBusy ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </Modal>
    </>
  );
}

function Stat({
  label,
  value,
  mono = false,
  highlight = false,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  title?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={title}>
      <span
        className={mono ? 'font-mono text-xs' : 'text-xs'}
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
      <span
        className="font-mono text-[9px] uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </span>
    </div>
  );
}

function Separator() {
  return (
    <div
      className="w-px h-6"
      style={{ backgroundColor: 'var(--border)' }}
    />
  );
}
