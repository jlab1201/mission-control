'use client';

import { useState, useEffect } from 'react';
import { listHosts, forgetHost, type KnownHost } from '@/lib/api/hosts';
import type { WorkspaceConfig, InspectResponse } from '@/types/workspace';

const HOST_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const HOSTS_POLL_MS = 5000;

// ---------------------------------------------------------------------------

interface Props { onHostsChange?: (hosts: KnownHost[]) => void; }

export function ConnectionsTab({ onHostsChange }: Props) {
  const [origin, setOrigin] = useState('');

  const [hostId, setHostId] = useState('');

  const [pathInput, setPathInput] = useState('');
  const [pathStatus, setPathStatus] = useState('');
  const [pathBusy, setPathBusy] = useState(false);
  const [pathMsg, setPathMsg] = useState('');

  const [hosts, setHosts] = useState<KnownHost[]>([]);
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [ingestEnabled, setIngestEnabled] = useState<boolean | null>(null);
  const [ingestToken, setIngestToken] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch('/api/workspace/config').then((r) => r.json() as Promise<WorkspaceConfig>).then(setConfig).catch(() => {});
    fetch('/api/ingest/status').then((r) => r.json() as Promise<{ ingestEnabled: boolean; token: string | null }>)
      .then((d) => { setIngestEnabled(d.ingestEnabled); setIngestToken(d.token); })
      .catch(() => { setIngestEnabled(null); setIngestToken(null); });
    void loadHosts();
    const id = setInterval(() => { void loadHosts(); }, HOSTS_POLL_MS);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHosts() {
    try {
      const h = await listHosts();
      const sorted = [...h].sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0));
      setHosts(sorted);
      onHostsChange?.(sorted);
    } catch { /* non-fatal */ }
  }

  const hostIdValid = HOST_RE.test(hostId);

  async function handleTestPath() {
    if (!pathInput) return;
    setPathBusy(true); setPathStatus('');
    try {
      const r = await fetch(`/api/workspace/inspect?path=${encodeURIComponent(pathInput)}`).then((x) => x.json() as Promise<InspectResponse>);
      const parts = [r.state, r.canInstall ? 'team-kit not installed' : !r.canForceReinstall ? 'claude detected' : ''].filter(Boolean);
      setPathStatus(parts.join(' · '));
    } catch (e) { setPathStatus((e as Error).message); }
    finally { setPathBusy(false); }
  }

  async function handleSavePath() {
    if (!pathInput) return;
    setPathBusy(true); setPathMsg('');
    try {
      const res = await fetch('/api/workspace/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: pathInput }) });
      if (!res.ok) throw new Error('watch failed');
      setPathMsg('Added and switched watcher.');
      await fetch('/api/workspace/config').then((r) => r.json() as Promise<WorkspaceConfig>).then(setConfig).catch(() => {});
    } catch (e) { setPathMsg((e as Error).message); }
    finally { setPathBusy(false); }
  }

  const remoteProjects = hosts
    .filter((h) => !h.isLocal && h.watchedProjectPath)
    .map((h) => ({ hid: h.hostId, path: h.watchedProjectPath! }));

  return (
    <div className="flex flex-col gap-4">

      {/* ADD A HOST */}
      <Box label="Add a host">
        {ingestEnabled === false && (
          <div className="font-mono text-[11px] rounded p-2"
            style={{ background: 'color-mix(in srgb, var(--warning, #d97706) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warning, #d97706) 40%, transparent)', color: 'var(--foreground)' }}>
            ⚠ Multi-host ingest is disabled. Set <code>MC_INGEST_TOKENS</code> in the MC server&apos;s <code>.env</code> (generate with <code>openssl rand -hex 32</code>) and restart before remote reporters can connect.
          </div>
        )}
        <div className="flex gap-2 items-center">
          <label htmlFor="host-id" className="font-mono text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', width: 56 }}>Host ID</label>
          <input id="host-id" value={hostId} onChange={(e) => setHostId(e.target.value)} placeholder="my-host"
            aria-label="Host ID" className="flex-1 rounded px-2 py-1 font-mono text-xs" style={inputStyle} />
        </div>
        {hostId && !hostIdValid && (
          <p className="font-mono text-xs pl-16" style={{ color: 'var(--danger, #ef4444)' }}>
            Use 1–64 chars: letters, digits, hyphen, underscore.
          </p>
        )}
        {origin && (() => {
          const displayHostId = hostIdValid ? hostId : '<host-id>';
          const downloadCmd = `curl -fSLO ${origin}/mc-reporter.mjs`;
          const tokenForCopy = ingestToken ?? '<token>';
          const tokenForDisplay = ingestToken ? maskToken(ingestToken) : '<token>';
          const runCmdDisplay = `MC_REPORTER_TARGET_URL=${origin} \\\nMC_REPORTER_TOKEN=${tokenForDisplay} \\\nMC_REPORTER_HOST_ID=${displayHostId} \\\nnode mc-reporter.mjs`;
          const runCmdCopy = `MC_REPORTER_TARGET_URL=${origin} \\\nMC_REPORTER_TOKEN=${tokenForCopy} \\\nMC_REPORTER_HOST_ID=${displayHostId} \\\nnode mc-reporter.mjs`;
          return (
            <div className="font-mono text-[11px] rounded p-3 ml-16 flex flex-col gap-2"
              style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <div style={{ color: 'var(--foreground)' }}>
                On the <strong>{hostIdValid ? hostId : '<host-id>'}</strong> machine:
              </div>
              <div>
                1. Download the{' '}
                <a href="/mc-reporter.mjs" download
                  style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}>
                  reporter
                </a>{' '}
                or run the command:
              </div>
              <div className="flex items-start gap-2">
                <code className="flex-1 select-all rounded px-2 py-1" style={{ background: 'var(--surface)', color: 'var(--foreground)' }}>
                  {downloadCmd}
                </code>
                <CopyBtn value={downloadCmd} />
              </div>
              <div>2. Run it:</div>
              <div className="flex items-start gap-2">
                <pre className="flex-1 select-all rounded px-2 py-1 whitespace-pre-wrap break-all"
                  style={{ background: 'var(--surface)', color: 'var(--foreground)', margin: 0 }}>{runCmdDisplay}</pre>
                <CopyBtn value={runCmdCopy} />
              </div>
              <div>
                When the reporter posts, <strong>{hostIdValid ? hostId : 'the host'}</strong> appears below in Known hosts (auto-refreshed every {HOSTS_POLL_MS / 1000}s).
              </div>
            </div>
          );
        })()}
      </Box>

      {/* PROJECT PATH */}
      <Box label="Project path">
        <div className="flex gap-2 items-center">
          <label htmlFor="path-inp" className="font-mono text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', width: 56 }}>Path</label>
          <input id="path-inp" value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="/home/you/project"
            aria-label="Project path" className="flex-1 rounded px-2 py-1 font-mono text-xs" style={inputStyle} />
          <Btn onClick={handleTestPath} disabled={pathBusy || !pathInput} small>{pathBusy ? '…' : 'Test'}</Btn>
        </div>
        {pathStatus && <p className="font-mono text-xs pl-16" style={{ color: 'var(--text-muted)' }}>{pathStatus}</p>}
        <div className="flex justify-end gap-2 items-center">
          <span className="font-mono text-[11px] mr-auto" style={{ color: 'var(--text-muted)' }}>Saving will switch the local watch target.</span>
          {pathMsg && <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{pathMsg}</span>}
          <Btn onClick={handleSavePath} disabled={pathBusy || !pathInput}>{pathBusy ? '…' : 'Save to recents'}</Btn>
        </div>
      </Box>

      {/* KNOWN HOSTS */}
      <Box label="Known hosts">
        {hosts.length === 0
          ? <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>No hosts yet.</p>
          : hosts.map((h) => (
              <div key={h.hostId} className="flex items-center gap-2">
                <span aria-hidden>{h.status === 'live' ? '🟢' : h.status === 'stale' ? '🟡' : '⚪'}</span>
                <span className="font-mono text-xs flex-1 truncate" style={{ color: 'var(--foreground)' }}>
                  {h.hostLabel ?? h.hostId}{h.isLocal ? ' (local)' : ''} · {h.agentCount} agents
                </span>
                {!h.isLocal && (
                  <Btn small variant="danger" onClick={async () => { try { await forgetHost(h.hostId); await loadHosts(); } catch { /**/ } }}>Forget</Btn>
                )}
              </div>
            ))
        }
      </Box>

      {/* REGISTERED PROJECTS */}
      <Box label="Registered projects">
        {(!config?.recentPaths?.length && !remoteProjects.length)
          ? <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>No paths yet.</p>
          : <>
              {(config?.recentPaths ?? []).map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <span className="font-mono text-xs flex-1 truncate" style={{ color: 'var(--foreground)' }} title={p}>
                    <span style={{ color: 'var(--text-muted)' }}>local · </span>{p}
                  </span>
                  {p !== config?.watchPath && (
                    <Btn small variant="danger" onClick={async () => {
                      try {
                        await fetch('/api/workspace/forget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) });
                        await fetch('/api/workspace/config').then((r) => r.json() as Promise<WorkspaceConfig>).then(setConfig).catch(() => {});
                      } catch { /**/ }
                    }}>Forget</Btn>
                  )}
                </div>
              ))}
              {remoteProjects.map(({ hid, path }) => (
                <div key={`${hid}:${path}`} className="flex items-center gap-2">
                  <span className="font-mono text-xs flex-1 truncate" style={{ color: 'var(--foreground)' }} title={path}>
                    <span style={{ color: 'var(--text-muted)' }}>{hid} · </span>{path}
                  </span>
                </div>
              ))}
            </>
        }
      </Box>

    </div>
  );
}

function maskToken(t: string): string {
  if (t.length <= 8) return '•'.repeat(t.length);
  return `${t.slice(0, 4)}${'•'.repeat(12)}${t.slice(-4)}`;
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function handleClick() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API unavailable (non-secure context); fail silently */
    }
  }
  return (
    <button onClick={handleClick} aria-label="Copy to clipboard"
      className="font-mono text-[10px] rounded px-2 py-1 flex-shrink-0 transition-colors"
      style={{
        background: copied ? 'color-mix(in srgb, var(--accent-primary) 20%, transparent)' : 'var(--surface-elevated)',
        border: '1px solid var(--border)',
        color: copied ? 'var(--accent-primary)' : 'var(--foreground)',
        cursor: 'pointer',
      }}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-elevated)',
  border: '1px solid var(--border)',
  color: 'var(--foreground)',
  outline: 'none',
};

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded p-3 flex flex-col gap-2" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
      <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </div>
  );
}

function Btn({ children, onClick, disabled, small, variant = 'primary' }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; small?: boolean; variant?: 'primary' | 'danger';
}) {
  const danger = variant === 'danger';
  return (
    <button onClick={onClick} disabled={disabled}
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
