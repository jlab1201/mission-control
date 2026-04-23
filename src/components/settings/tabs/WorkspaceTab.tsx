'use client';

import { useState, useEffect } from 'react';
import { useMissionStore } from '@/lib/store/missionStore';
import { useShallow } from 'zustand/react/shallow';
import { listHosts, type KnownHost } from '@/lib/api/hosts';
import type { WorkspaceConfig } from '@/types/workspace';

// ---------------------------------------------------------------------------

interface Props { initialConfig: WorkspaceConfig | null; hosts: KnownHost[]; onClose: () => void; }

export function WorkspaceTab({ initialConfig, hosts: hostsProp, onClose }: Props) {
  const { mission, setSelectedHostId } = useMissionStore(
    useShallow((s) => ({ mission: s.mission, setSelectedHostId: s.setSelectedHostId })),
  );

  const [hosts, setHosts] = useState<KnownHost[]>(hostsProp);
  const [config, setConfig] = useState<WorkspaceConfig | null>(initialConfig);
  const [selHostId, setSelHostId] = useState('');
  const [selPath, setSelPath] = useState('');
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState('');
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => { setHosts(hostsProp); }, [hostsProp]);
  useEffect(() => { setConfig(initialConfig); }, [initialConfig]);

  useEffect(() => {
    fetch('/api/workspace/config')
      .then((r) => r.json() as Promise<WorkspaceConfig>)
      .then(setConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    listHosts()
      .then((h) => setHosts([...h].sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selHostId && hosts.length > 0)
      setSelHostId((hosts.find((h) => h.isLocal) ?? hosts[0]).hostId);
  }, [hosts, selHostId]);

  useEffect(() => {
    if (!selPath && config?.watchPath) setSelPath(config.watchPath);
  }, [config, selPath]);

  const selectedHost = hosts.find((h) => h.hostId === selHostId);
  const isRemote = !!(selectedHost && !selectedHost.isLocal);
  const pathOptions = isRemote
    ? [selectedHost?.watchedProjectPath ?? '']
    : config
      ? [config.watchPath, ...config.recentPaths.filter((p) => p !== config.watchPath)].filter(Boolean) as string[]
      : [];
  const cwd = mission?.cwd ?? config?.watchPath ?? null;
  const localHost = hosts.find((h) => h.isLocal);

  async function handleApply() {
    if (!selPath) return;
    setApplying(true); setMsg('');
    try {
      if (isRemote) {
        setSelectedHostId(selHostId);
        setMsg('Dashboard filtered.');
      } else {
        const res = await fetch('/api/workspace/watch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: selPath }),
        });
        if (!res.ok) throw new Error('watch failed');
        setSelectedHostId(null);
        onClose();
      }
    } catch (e) { setMsg((e as Error).message); }
    finally { setApplying(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* PROJECT */}
      <Box label="Project">
        <Row label="Watching" value={cwd ? cwd.split('/').filter(Boolean).at(-1)! : '—'} />
        <Row label="Host" value={localHost?.hostLabel ?? localHost?.hostId ?? '—'} />
        <Row label="Path" value={cwd ?? '—'} mono />
      </Box>

      {/* SELECT */}
      <Box label="Select">
        <Row label="Host">
          <select value={selHostId} onChange={(e) => { setSelHostId(e.target.value); setSelPath(''); }}
            aria-label="Select host" style={inputStyle}
            className="w-full rounded px-2 py-1 font-mono text-xs">
            {hosts.length === 0 && <option value="">(loading…)</option>}
            {hosts.map((h) => (
              <option key={h.hostId} value={h.hostId}>
                {h.hostLabel ?? h.hostId}{h.isLocal ? ' (local)' : ''} · {h.agentCount} agents
              </option>
            ))}
          </select>
        </Row>
        <Row label="Project">
          {isRemote
            ? <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{selectedHost?.watchedProjectPath ?? '(not reported yet)'}</span>
            : <select value={selPath} onChange={(e) => setSelPath(e.target.value)}
                aria-label="Select project path" style={inputStyle}
                className="w-full rounded px-2 py-1 font-mono text-xs">
                {pathOptions.map((p) => <option key={p} value={p}>{p || '(none)'}</option>)}
              </select>
          }
        </Row>
        <div className="flex items-center justify-end gap-2 mt-1">
          {isRemote && <span className="font-mono text-[11px] mr-auto" style={{ color: 'var(--text-muted)' }}>Remote hosts filter the dashboard view only.</span>}
          {msg && <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{msg}</span>}
          <Btn onClick={handleApply} disabled={applying || !selPath}>{applying ? '…' : 'Apply'}</Btn>
        </div>
      </Box>

      {/* TEAM-KIT */}
      <div className="flex items-center gap-3 pt-1">
        <a href="/api/workspace/teamkit.zip" download
          className="font-mono text-xs px-3 py-1.5 rounded"
          style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--foreground)', textDecoration: 'none' }}>
          Download Team-kit
        </a>
        <button onClick={() => setShowInfo((v) => !v)} aria-expanded={showInfo}
          className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          {showInfo ? 'Hide' : 'What is this?'}
        </button>
      </div>
      {showInfo && (
        <p className="font-mono text-[11px] leading-relaxed rounded p-3"
          style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Team-kit is the bundled set of agent role definitions (backend-dev, frontend-dev,
          qa-engineer, etc.) and their prompt templates. Download and unzip into your project&apos;s{' '}
          <code>.claude/</code> directory to give Claude Code instant access to the team. You can
          edit the markdown files to customize each agent&apos;s behavior.
        </p>
      )}
    </div>
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

function Row({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2" style={{ gridTemplateColumns: '80px 1fr' }}>
      <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      {children ?? (
        <span className={`text-xs truncate${mono ? ' font-mono' : ''}`} style={{ color: 'var(--foreground)' }} title={value}>{value}</span>
      )}
    </div>
  );
}

function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="font-mono text-xs px-3 py-1.5 rounded transition-colors"
      style={{
        background: disabled ? 'var(--surface-elevated)' : 'var(--accent-primary)',
        color: disabled ? 'var(--text-muted)' : 'var(--background)',
        border: '1px solid var(--border)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}>
      {children}
    </button>
  );
}
