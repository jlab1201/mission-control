'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, X, Copy } from 'lucide-react';
import { listHosts, disconnectHost, type KnownHost } from '@/lib/api/hosts';
import {
  listProjects,
  testProject as apiTestProject,
  registerProject,
  deleteProject,
} from '@/lib/api/projects';
import type { RegisteredProjectRow } from '@/types/workspace';
import { Modal } from '@/components/ui/Modal';

// ---------------------------------------------------------------------------

interface Props { hosts: KnownHost[]; onClose: () => void; }

export function WorkspaceTab({ hosts: hostsProp, onClose: _onClose }: Props) {
  const [hosts, setHosts] = useState<KnownHost[]>(hostsProp);
  const [showInfo, setShowInfo] = useState(false);

  // Register-a-Project state
  const [projName, setProjName] = useState('');
  const [projHostId, setProjHostId] = useState('local');
  const [projPath, setProjPath] = useState('');
  const [projBusy, setProjBusy] = useState(false);
  const [projResult, setProjResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Host popover state
  const [hostMenuOpen, setHostMenuOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<
    { hostId: string; hostLabel: string; projectCount: number } | null
  >(null);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const hostMenuRef = useRef<HTMLDivElement | null>(null);

  // Registered Projects state
  const [projects, setProjects] = useState<RegisteredProjectRow[]>([]);

  useEffect(() => { setHosts(hostsProp); }, [hostsProp]);

  const loadHosts = useCallback(async () => {
    try {
      const h = await listHosts();
      setHosts([...h].sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0)));
    } catch { /* non-fatal */ }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const { projects: p } = await listProjects();
      setProjects(p);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    void loadHosts();
    void loadProjects();
    const hostsTimer = setInterval(() => { void loadHosts(); }, 5000);
    const projTimer = setInterval(() => { void loadProjects(); }, 5000);
    return () => { clearInterval(hostsTimer); clearInterval(projTimer); };
  }, [loadHosts, loadProjects]);

  // Close host popover on click-outside
  useEffect(() => {
    if (!hostMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (hostMenuRef.current && !hostMenuRef.current.contains(e.target as Node)) {
        setHostMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [hostMenuOpen]);

  // ---------------------------------------------------------------------------
  // Register handlers
  // ---------------------------------------------------------------------------
  const projNameValid = projName.trim().length >= 1 && projName.trim().length <= 128;
  const projHostSelected = projHostId.length > 0;
  const projPathValid = projPath.trim().length > 0;
  const projFormValid = projNameValid && projHostSelected && projPathValid;

  async function handleRegister() {
    if (!projFormValid) return;
    setProjBusy(true);
    setProjResult(null);
    try {
      const testRes = await apiTestProject(projHostId, projPath.trim());
      if (!testRes.ok) {
        const reasonMap: Record<string, string> = {
          missing: 'Path not found on this machine',
          'not-directory': 'Not a directory',
          'not-readable': 'Not readable',
          'host-not-found': 'Host hasn\'t connected yet — add it in Connections first',
          'host-stale': 'Host is offline — waiting for reporter to reconnect',
        };
        const msg = (testRes.reason && reasonMap[testRes.reason]) ?? 'Could not verify path';
        setProjResult({ ok: false, msg });
        return;
      }
      await registerProject(projName.trim(), projHostId, projPath.trim());
      void loadProjects();
      setProjName('');
      setProjHostId('local');
      setProjPath('');
      setProjResult({ ok: true, msg: 'Registered' });
    } catch (e) {
      setProjResult({ ok: false, msg: (e as Error).message ?? 'Registration failed' });
    } finally {
      setProjBusy(false);
    }
  }

  async function handleRemoveProject(id: string, name: string) {
    if (!confirm(`Remove "${name}" from registered projects?`)) return;
    try {
      await deleteProject(id);
      void loadProjects();
    } catch { /* non-fatal */ }
  }

  function handleDisconnectHost(hostId: string, hostLabel: string) {
    const projectCount = projects.filter((p) => p.hostId === hostId).length;
    setDisconnectTarget({ hostId, hostLabel, projectCount });
    // Refresh in the background so stale state (e.g. server restart) is caught.
    void loadHosts();
  }

  async function confirmDisconnectHost() {
    if (!disconnectTarget) return;
    const { hostId } = disconnectTarget;
    setDisconnectBusy(true);
    try {
      await disconnectHost(hostId);
      if (projHostId === hostId) setProjHostId('local');
      void loadHosts();
      void loadProjects();
      setDisconnectTarget(null);
    } catch (e) {
      console.error('disconnectHost error:', e);
    } finally {
      setDisconnectBusy(false);
    }
  }

  // Host picker options: local first, then remotes alphabetically
  const hostOptions = [
    ...hosts.filter((h) => h.isLocal),
    ...hosts.filter((h) => !h.isLocal).sort((a, b) => {
      const la = a.hostLabel ?? a.hostId;
      const lb = b.hostLabel ?? b.hostId;
      return la.localeCompare(lb);
    }),
  ];

  // Label for the currently-selected host in the button
  function hostButtonLabel(hostId: string): string {
    if (hostId === 'local') {
      const localHost = hosts.find((h) => h.isLocal);
      return localHost?.hostLabel ?? 'local';
    }
    const h = hosts.find((hh) => hh.hostId === hostId);
    return h ? (h.hostLabel ?? h.hostId) : hostId;
  }

  function hostRowLabel(h: KnownHost): string {
    if (h.isLocal) return h.hostLabel ?? 'local';
    return h.hostLabel ?? h.hostId;
  }

  return (
    <div className="flex flex-col gap-4">

      {/* TEAM-KIT */}
      <div className="flex items-center gap-3 pt-1">
        <a href="/api/workspace/teamkit.zip" download
          className="font-mono text-xs px-3 py-1.5 rounded"
          style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--foreground)', textDecoration: 'none' }}>
          Download Team-kit
        </a>
        <span
          className="relative"
          onMouseEnter={() => setShowInfo(true)}
          onMouseLeave={() => setShowInfo(false)}
          onFocus={() => setShowInfo(true)}
          onBlur={() => setShowInfo(false)}
        >
          <span
            tabIndex={0}
            aria-describedby="teamkit-info"
            className="font-mono text-xs cursor-help underline decoration-dotted underline-offset-4"
            style={{ color: 'var(--text-muted)' }}
          >
            What is this?
          </span>
          {showInfo && (
            <div
              id="teamkit-info"
              role="tooltip"
              className="absolute font-mono text-[11px] leading-relaxed rounded p-3"
              style={{
                top: 'calc(100% + 6px)',
                left: 0,
                zIndex: 60,
                width: 320,
                background: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                boxShadow: '0 8px 24px -4px color-mix(in srgb, var(--foreground) 25%, transparent)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            >
              Team-kit is the bundled set of agent role definitions (backend-dev, frontend-dev,
              qa-engineer, etc.) and their prompt templates. Download and unzip into your project&apos;s{' '}
              <code>.claude/</code> directory to give Claude Code instant access to the team. You can
              edit the markdown files to customize each agent&apos;s behavior.
            </div>
          )}
        </span>
      </div>

      {/* ================================================================= */}
      {/* REGISTER A PROJECT                                                  */}
      {/* ================================================================= */}
      <Box label="Register a project">
        <div className="flex flex-col gap-2">
          {/* Project Name */}
          <div className="flex gap-2 items-center">
            <label htmlFor="ws-proj-name" className="font-mono text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', width: 56 }}>Name</label>
            <input
              id="ws-proj-name"
              value={projName}
              onChange={(e) => { setProjName(e.target.value); setProjResult(null); }}
              placeholder="My App"
              aria-label="Project name"
              className="flex-1 rounded px-2 py-1 font-mono text-xs"
              style={inputStyle}
            />
          </div>
          {/* Host popover picker */}
          <div className="flex gap-2 items-center">
            <label htmlFor="ws-proj-host-btn" className="font-mono text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', width: 56 }}>Host</label>
            <div ref={hostMenuRef} className="flex-1" style={{ position: 'relative' }}>
              <button
                id="ws-proj-host-btn"
                type="button"
                onClick={() => setHostMenuOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={hostMenuOpen}
                aria-label="Select host"
                className="w-full flex items-center justify-between rounded px-2 py-1 font-mono text-xs transition-colors"
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <span className="truncate">{hostButtonLabel(projHostId)}</span>
                <ChevronDown size={12} strokeWidth={2} style={{ flexShrink: 0, marginLeft: 4, opacity: 0.6 }} />
              </button>

              {hostMenuOpen && (
                <div
                  className="absolute mt-1 rounded-lg overflow-hidden"
                  style={{
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 40,
                    padding: '0.25rem',
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border-strong)',
                    boxShadow: '0 12px 32px -8px color-mix(in srgb, var(--foreground) 35%, transparent)',
                  }}
                  role="listbox"
                >
                  {hostOptions.map((h) => {
                    const label = hostRowLabel(h);
                    const isSelected = projHostId === (h.isLocal ? 'local' : h.hostId);
                    return (
                      <div
                        key={h.hostId}
                        className="flex items-center gap-1 rounded-md transition-all duration-150"
                        style={{
                          backgroundColor: isSelected
                            ? 'color-mix(in srgb, var(--accent-primary) 10%, transparent)'
                            : 'transparent',
                        }}
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setProjHostId(h.isLocal ? 'local' : h.hostId);
                            setProjResult(null);
                            setHostMenuOpen(false);
                          }}
                          className="flex-1 text-left px-3 py-1.5 font-mono text-xs transition-all duration-150"
                          style={{
                            color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            background: 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          {label}
                        </button>
                        {!h.isLocal && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHostMenuOpen(false);
                              void handleDisconnectHost(h.hostId, h.hostLabel ?? h.hostId);
                            }}
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
                            title={`Disconnect ${h.hostLabel ?? h.hostId}`}
                            aria-label={`Disconnect host ${h.hostLabel ?? h.hostId}`}
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
          {/* Path */}
          <div className="flex gap-2 items-center">
            <label htmlFor="ws-proj-path" className="font-mono text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', width: 56 }}>Path</label>
            <input
              id="ws-proj-path"
              value={projPath}
              onChange={(e) => { setProjPath(e.target.value); setProjResult(null); }}
              placeholder="/absolute/path/to/project"
              aria-label="Project path"
              className="flex-1 rounded px-2 py-1 font-mono text-xs"
              style={inputStyle}
            />
          </div>
          {/* Submit + feedback */}
          <div className="flex items-center gap-3 justify-end pt-1">
            {projResult && (
              <span className="font-mono text-[11px]" style={{ color: projResult.ok ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)' }}>
                {projResult.ok ? '✓' : '✗'} {projResult.msg}
              </span>
            )}
            <Btn onClick={() => { void handleRegister(); }} disabled={projBusy || !projFormValid} small>
              {projBusy ? '…' : 'Test & Register'}
            </Btn>
          </div>
        </div>
      </Box>

      {/* ================================================================= */}
      {/* REGISTERED PROJECTS TABLE                                           */}
      {/* ================================================================= */}
      <Box label="Registered projects">
        {projects.length === 0
          ? (
            <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              No projects registered yet. Register a project above.
            </p>
          )
          : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs border-collapse">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {(['Name', 'Path', 'Host', 'Status', ''] as const).map((col) => (
                      <th key={col} className="text-left py-1 pr-3" style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)' }}>
                      <td className="py-1.5 pr-3 truncate max-w-[120px]" style={{ color: 'var(--foreground)' }} title={p.name}>{p.name}</td>
                      <td className="py-1.5 pr-3 max-w-[200px]" style={{ color: 'var(--text-muted)' }} title={p.path}>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 truncate">{p.path}</span>
                          <InlineCopyBtn value={p.path} />
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {p.hostLabel ?? p.hostId}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <StatusDot status={p.hostStatus} />
                      </td>
                      <td className="py-1.5">
                        <Btn
                          small
                          variant="danger"
                          onClick={() => { void handleRemoveProject(p.id, p.name); }}
                        >
                          Remove
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Box>

      <Modal
        open={!!disconnectTarget}
        onClose={() => { if (!disconnectBusy) setDisconnectTarget(null); }}
        maxWidth="max-w-md"
        aria-label="Disconnect host"
      >
        <div className="flex flex-col gap-3 p-5">
          <h2
            className="font-mono text-sm font-bold tracking-widest"
            style={{ color: 'var(--foreground)', letterSpacing: '0.1em' }}
          >
            DISCONNECT HOST?
          </h2>
          <p className="font-mono text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Host <strong style={{ color: 'var(--foreground)' }}>{disconnectTarget?.hostLabel}</strong>{' '}
            has <strong style={{ color: 'var(--foreground)' }}>{disconnectTarget?.projectCount}</strong>{' '}
            project{disconnectTarget?.projectCount === 1 ? '' : 's'} under it. Disconnecting will remove{' '}
            all of them and stop the reporter on that host.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDisconnectTarget(null)}
              disabled={disconnectBusy}
              className="font-mono text-xs px-3 py-1.5 rounded transition-colors"
              style={{
                background: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
                cursor: disconnectBusy ? 'not-allowed' : 'pointer',
                opacity: disconnectBusy ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => { void confirmDisconnectHost(); }}
              disabled={disconnectBusy}
              className="font-mono text-xs px-3 py-1.5 rounded transition-colors"
              style={{
                background: 'color-mix(in srgb, var(--danger) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
                color: 'var(--danger)',
                cursor: disconnectBusy ? 'not-allowed' : 'pointer',
                opacity: disconnectBusy ? 0.6 : 1,
              }}
            >
              {disconnectBusy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineCopyBtn — small copy icon with 600ms check swap
// ---------------------------------------------------------------------------

function InlineCopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 600);
        }).catch(() => {});
      }}
      aria-label="Copy path"
      title="Copy path"
      className="flex items-center justify-center flex-shrink-0 transition-colors rounded"
      style={{
        marginLeft: 2,
        padding: '1px 2px',
        background: 'transparent',
        color: copied ? 'var(--accent-primary)' : 'var(--text-muted)',
        cursor: 'pointer',
      }}
    >
      {copied
        ? <span style={{ fontSize: 10, lineHeight: 1 }}>✓</span>
        : <Copy size={12} strokeWidth={2} />
      }
    </button>
  );
}

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<RegisteredProjectRow['hostStatus'], { dot: string; label: string; color: string }> = {
  live:    { dot: '●', label: 'live',    color: 'var(--success, #22c55e)' },
  stale:   { dot: '●', label: 'stale',   color: 'var(--warning, #d97706)' },
  pending: { dot: '●', label: 'pending', color: 'var(--text-muted)' },
  unknown: { dot: '●', label: 'unknown', color: 'var(--text-muted)' },
};

function StatusDot({ status }: { status: RegisteredProjectRow['hostStatus'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  return (
    <span className="flex items-center gap-1">
      <span aria-hidden style={{ color: cfg.color, fontSize: 8, lineHeight: 1 }}>{cfg.dot}</span>
      <span style={{ color: 'var(--text-muted)' }}>{cfg.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-elevated)',
  border: '1px solid var(--border)',
  color: 'var(--foreground)',
  outline: 'none',
};

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded p-3 flex flex-col gap-2"
      style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
      <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </div>
  );
}

function Btn({
  children, onClick, disabled, small, variant = 'primary',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
  variant?: 'primary' | 'danger';
}) {
  const danger = variant === 'danger';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`font-mono rounded flex-shrink-0 transition-colors ${small ? 'text-[11px] px-2 py-1' : 'text-xs px-3 py-1.5'}`}
      style={{
        background: disabled ? 'var(--surface-elevated)' : danger ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : 'var(--accent-primary)',
        color: disabled ? 'var(--text-muted)' : danger ? 'var(--danger)' : 'var(--background)',
        border: `1px solid ${danger ? 'color-mix(in srgb, var(--danger) 40%, transparent)' : 'var(--border)'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}>
      {children}
    </button>
  );
}
