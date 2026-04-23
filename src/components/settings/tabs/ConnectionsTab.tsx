'use client';

import { useState, useEffect } from 'react';
import { listHosts, registerHost, forgetHost, testHost, type KnownHost } from '@/lib/api/hosts';
import type { WorkspaceConfig, InspectResponse } from '@/types/workspace';

const HOST_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ---------------------------------------------------------------------------

interface Props { onHostsChange?: (hosts: KnownHost[]) => void; }

export function ConnectionsTab({ onHostsChange }: Props) {
  const [origin, setOrigin] = useState('');

  const [hostId, setHostId] = useState('');
  const [hostStatus, setHostStatus] = useState('');
  const [hostBusy, setHostBusy] = useState(false);
  const [hostMsg, setHostMsg] = useState('');

  const [pathInput, setPathInput] = useState('');
  const [pathStatus, setPathStatus] = useState('');
  const [pathBusy, setPathBusy] = useState(false);
  const [pathMsg, setPathMsg] = useState('');

  const [hosts, setHosts] = useState<KnownHost[]>([]);
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch('/api/workspace/config').then((r) => r.json() as Promise<WorkspaceConfig>).then(setConfig).catch(() => {});
    void loadHosts();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHosts() {
    try {
      const h = await listHosts();
      const sorted = [...h].sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0));
      setHosts(sorted);
      onHostsChange?.(sorted);
    } catch { /* non-fatal */ }
  }

  async function handleTestHost() {
    if (!HOST_RE.test(hostId)) { setHostStatus('Invalid host ID format.'); return; }
    setHostBusy(true); setHostStatus('');
    try {
      const r = await testHost(hostId);
      const dot = r.status === 'live' ? '🟢' : r.status === 'stale' ? '🟡' : '⚪';
      setHostStatus(`${dot} ${r.status} · ${r.agentCount} agents${r.lastPostedAt ? ` · last seen ${ago(r.lastPostedAt)}` : ''}`);
    } catch (e) {
      const m = (e as Error).message;
      setHostStatus(m.includes('404') ? '❓ unknown — save it first, then start the reporter' : `Error: ${m}`);
    } finally { setHostBusy(false); }
  }

  async function handleSaveHost() {
    if (!HOST_RE.test(hostId)) { setHostMsg('Invalid host ID.'); return; }
    setHostBusy(true); setHostMsg('');
    try {
      await registerHost({ hostId });
      setHostMsg('Saved.'); setHostId(''); setHostStatus('');
      await loadHosts();
    } catch (e) { setHostMsg((e as Error).message); }
    finally { setHostBusy(false); }
  }

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

      {/* HOST CONNECTION */}
      <Box label="Host connection">
        <div className="flex gap-2 items-center">
          <label htmlFor="host-id" className="font-mono text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', width: 56 }}>Host ID</label>
          <input id="host-id" value={hostId} onChange={(e) => setHostId(e.target.value)} placeholder="my-host"
            aria-label="Host ID" className="flex-1 rounded px-2 py-1 font-mono text-xs" style={inputStyle} />
          <Btn onClick={handleTestHost} disabled={hostBusy || !hostId} small>{hostBusy ? '…' : 'Test'}</Btn>
        </div>
        {hostStatus && <p className="font-mono text-xs pl-16" style={{ color: 'var(--text-muted)' }}>{hostStatus}</p>}
        <div className="flex justify-end gap-2 items-center">
          {hostMsg && <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{hostMsg}</span>}
          <Btn onClick={handleSaveHost} disabled={hostBusy || !hostId}>{hostBusy ? '…' : 'Save'}</Btn>
        </div>
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

      {/* REPORTER SCRIPT */}
      <Box label="Reporter script">
        <div className="flex items-center gap-3">
          <a href="/mc-reporter.mjs" download className="font-mono text-xs px-3 py-1.5 rounded"
            style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--foreground)', textDecoration: 'none' }}>
            Download mc-reporter.mjs
          </a>
        </div>
        {origin && (
          <code className="font-mono text-[11px] rounded px-3 py-2 block select-all"
            style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            curl -fSLO {origin}/mc-reporter.mjs
          </code>
        )}
      </Box>
    </div>
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
