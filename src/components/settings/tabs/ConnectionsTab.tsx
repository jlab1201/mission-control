'use client';

import { useState, useEffect, useCallback } from 'react';
import { listHosts, type KnownHost } from '@/lib/api/hosts';
import { testHost as apiTestHost } from '@/lib/api/projects';

const HOST_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const HOSTS_POLL_MS = 5000;

// ---------------------------------------------------------------------------

interface Props { onHostsChange?: (hosts: KnownHost[]) => void; }

export function ConnectionsTab({ onHostsChange }: Props) {
  const [origin, setOrigin] = useState('');
  const [ingestEnabled, setIngestEnabled] = useState<boolean | null>(null);
  const [ingestToken, setIngestToken] = useState<string | null>(null);

  // Section 1 — Add a Host
  const [hostId, setHostId] = useState('');
  const [reporterTip, setReporterTip] = useState(false);
  const [hostTestBusy, setHostTestBusy] = useState(false);
  const [hostTestResult, setHostTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [hosts, setHosts] = useState<KnownHost[]>([]);

  const loadHosts = useCallback(async () => {
    try {
      const h = await listHosts();
      const sorted = [...h].sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0));
      setHosts(sorted);
      onHostsChange?.(sorted);
    } catch { /* non-fatal */ }
  }, [onHostsChange]);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch('/api/ingest/status')
      .then((r) => r.json() as Promise<{ ingestEnabled: boolean; token: string | null }>)
      .then((d) => { setIngestEnabled(d.ingestEnabled); setIngestToken(d.token); })
      .catch(() => { setIngestEnabled(null); setIngestToken(null); });
    void loadHosts();
    const hostsTimer = setInterval(() => { void loadHosts(); }, HOSTS_POLL_MS);
    return () => { clearInterval(hostsTimer); };
  }, [loadHosts]);

  // ---------------------------------------------------------------------------
  // Section 1 handlers
  // ---------------------------------------------------------------------------
  const hostIdValid = HOST_RE.test(hostId);

  async function handleTestHost() {
    if (!hostIdValid) return;
    setHostTestBusy(true);
    setHostTestResult(null);
    try {
      const r = await apiTestHost(hostId);
      if (r.ok) {
        let timeStr = 'just now';
        if (r.lastPostedAt) {
          const secsAgo = Math.round((Date.now() - new Date(r.lastPostedAt).getTime()) / 1000);
          timeStr = secsAgo <= 5 ? 'just now' : `${secsAgo}s ago`;
        }
        setHostTestResult({ ok: true, msg: `Host verified — last post ${timeStr}` });
        void loadHosts();
      } else {
        const reason = r.reason ?? 'not-found';
        const msg =
          reason === 'stale'
            ? 'Host was seen earlier but hasn\'t posted recently'
            : 'No posts received — run the reporter command in Step 2';
        setHostTestResult({ ok: false, msg });
      }
    } catch {
      setHostTestResult({ ok: false, msg: 'Could not reach the server — try again' });
    } finally {
      setHostTestBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">

      {/* ================================================================= */}
      {/* 1. ADD A HOST                                                       */}
      {/* ================================================================= */}
      <Box label="Add a host">
        {ingestEnabled === false && (
          <div className="font-mono text-[11px] rounded p-2"
            style={{ background: 'color-mix(in srgb, var(--warning, #d97706) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warning, #d97706) 40%, transparent)', color: 'var(--foreground)' }}>
            ⚠ Multi-host ingest is disabled. Set <code>MC_INGEST_TOKENS</code> in the MC server&apos;s <code>.env</code> (generate with <code>openssl rand -hex 32</code>) and restart before remote reporters can connect.
          </div>
        )}
        <div className="flex gap-2 items-center">
          <label htmlFor="host-id" className="font-mono text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', width: 56 }}>Host ID</label>
          <input
            id="host-id"
            value={hostId}
            onChange={(e) => { setHostId(e.target.value); setHostTestResult(null); }}
            placeholder="my-host"
            aria-label="Host ID"
            className="flex-1 rounded px-2 py-1 font-mono text-xs"
            style={inputStyle}
          />
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
                <span
                  className="relative inline-block"
                  onMouseEnter={() => setReporterTip(true)}
                  onMouseLeave={() => setReporterTip(false)}
                >
                  <a
                    href="/mc-reporter.mjs"
                    download
                    aria-describedby="reporter-info"
                    onFocus={() => setReporterTip(true)}
                    onBlur={() => setReporterTip(false)}
                    style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}
                  >
                    reporter
                  </a>
                  {reporterTip && (
                    <span
                      id="reporter-info"
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
                        whiteSpace: 'normal',
                      }}
                    >
                      A small Node.js script ({'<'}19&nbsp;KB) that runs on the target machine.
                      It tails local Claude Code session files under{' '}
                      <code>~/.claude/projects/</code> and posts live agent &amp; task data
                      back to Mission Control over HTTPS. Requires Node&nbsp;20+.
                    </span>
                  )}
                </span>{' '}
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
              <p className="text-[11px]" style={{ color: 'var(--text-muted)', margin: 0 }}>
                Once steps 1 and 2 are complete, click <strong style={{ color: 'var(--foreground)' }}>Test</strong> to verify your reporter is sending data.
              </p>
              <div className="flex items-center gap-3 pt-1 justify-end">
                {hostTestResult && (
                  <span className="font-mono text-[11px] mr-auto" style={{ color: hostTestResult.ok ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)' }}>
                    {hostTestResult.ok ? '✓' : '✗'} {hostTestResult.msg}
                  </span>
                )}
                <Btn
                  onClick={() => { void handleTestHost(); }}
                  disabled={hostTestBusy || !hostIdValid}
                  small
                >
                  {hostTestBusy ? '…' : 'Test'}
                </Btn>
              </div>
            </div>
          );
        })()}
      </Box>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button
      onClick={handleClick}
      aria-label="Copy to clipboard"
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

function Btn({
  children, onClick, disabled, small,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`font-mono rounded flex-shrink-0 transition-colors ${small ? 'text-[11px] px-2 py-1' : 'text-xs px-3 py-1.5'}`}
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
