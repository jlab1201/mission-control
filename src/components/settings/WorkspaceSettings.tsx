'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { listHosts, type KnownHost } from '@/lib/api/hosts';
import { WorkspaceTab } from '@/components/settings/tabs/WorkspaceTab';
import { ConnectionsTab } from '@/components/settings/tabs/ConnectionsTab';

type Tab = 'workspace' | 'hosts';

// ---------------------------------------------------------------------------
// WorkspaceSettings
// ---------------------------------------------------------------------------

interface WorkspaceSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function WorkspaceSettings({ open, onClose }: WorkspaceSettingsProps) {
  const [tab, setTab] = useState<Tab>('workspace');
  const [hosts, setHosts] = useState<KnownHost[]>([]);

  // Pre-fetch hosts for WorkspaceTab host dropdown (best-effort; tab mounts its own copy too)
  const refreshHosts = useCallback(() => {
    listHosts()
      .then((result) => {
        const sorted = [...result].sort((a, b) => {
          if (a.isLocal) return -1;
          if (b.isLocal) return 1;
          return 0;
        });
        setHosts(sorted);
      })
      .catch(() => {
        // Non-fatal — WorkspaceTab degrades gracefully
      });
  }, []);

  useEffect(() => {
    if (open) refreshHosts();
  }, [open, refreshHosts]);

  // Reset to workspace tab on close
  useEffect(() => {
    if (!open) setTab('workspace');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl" aria-label="Workspace settings">
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-6 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-[3px] h-5 rounded-full"
            style={{ background: 'var(--accent-primary)' }}
          />
          <span
            className="font-mono text-sm font-bold tracking-widest"
            style={{ color: 'var(--foreground)', letterSpacing: '0.12em' }}
          >
            SETTINGS
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--foreground)';
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              'color-mix(in srgb, var(--foreground) 6%, transparent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
          }}
          aria-label="Close settings"
        >
          &#x2715;
        </button>
      </div>

      {/* ── Tab bar ────────────────────────────────────────── */}
      <div
        className="flex gap-1 px-6 pt-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
        role="tablist"
        aria-label="Settings tabs"
      >
        {(
          [
            { id: 'workspace', label: 'Workspace' },
            { id: 'hosts', label: 'Connections' },
          ] as const
        ).map(({ id, label }) => {
          const isActive = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${id}`}
              id={`tab-${id}`}
              onClick={() => setTab(id)}
              className="font-mono text-xs uppercase tracking-widest px-4 py-2 transition-all duration-150 rounded-t-lg"
              style={{
                color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                backgroundColor: isActive
                  ? 'color-mix(in srgb, var(--accent-primary) 8%, transparent)'
                  : 'transparent',
                borderBottom: isActive
                  ? '2px solid var(--accent-primary)'
                  : '2px solid transparent',
                marginBottom: '-1px',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Tab panels ─────────────────────────────────────── */}
      <div
        className="overflow-y-auto px-6 py-5"
        style={{ maxHeight: 'calc(90vh - 108px)' }}
        role="tabpanel"
        id={`tabpanel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'workspace' && (
          <WorkspaceTab
            hosts={hosts}
            onClose={onClose}
          />
        )}
        {tab === 'hosts' && (
          <ConnectionsTab
            onHostsChange={(updated) => setHosts(updated)}
          />
        )}
      </div>
    </Modal>
  );
}
