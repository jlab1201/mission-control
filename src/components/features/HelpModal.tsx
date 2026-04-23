'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { HELP_ENTRIES } from '@/lib/config/helpContent';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  const panelRef = useRef<HTMLElement>(null);

  useFocusTrap(panelRef, open);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Click-outside to close
  const backdropRef = useRef<HTMLDivElement>(null);
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === backdropRef.current) onClose();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={backdropRef}
          onClick={handleBackdropClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-end',
            padding: '4rem 1.5rem 1.5rem 1.5rem',
            backgroundColor: 'color-mix(in srgb, var(--background) 60%, transparent)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard metrics guide"
            tabIndex={-1}
            initial={{ x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{
              width: '480px',
              maxWidth: 'calc(100vw - 3rem)',
              maxHeight: 'calc(100vh - 5.5rem)',
              overflowY: 'auto',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border-strong)',
              borderRadius: '10px',
              boxShadow:
                '0 20px 48px -12px color-mix(in srgb, var(--foreground) 40%, transparent)',
              outline: 'none',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 sticky top-0"
              style={{
                backgroundColor: 'var(--surface-elevated)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div className="flex flex-col gap-0.5">
                <span
                  className="font-mono text-[10px] uppercase tracking-widest font-bold"
                  style={{ color: 'var(--accent-primary)', letterSpacing: '0.15em' }}
                >
                  Dashboard Guide
                </span>
                <span
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  What every number means and where it comes from
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close guide (Esc)"
                title="Close (Esc)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition:
                    'color 120ms ease, border-color 120ms ease, background 120ms ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    'var(--danger)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    'var(--danger)';
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'color-mix(in srgb, var(--danger) 8%, transparent)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    'var(--text-muted)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    'var(--border)';
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'transparent';
                }}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-4 flex flex-col gap-5">
              {HELP_ENTRIES.map((entry) => (
                <HelpCard key={entry.label} entry={entry} />
              ))}

              {/* Footer note */}
              <div
                className="mt-2 px-4 py-3 rounded-md font-mono text-[11px] leading-relaxed"
                style={{
                  backgroundColor:
                    'color-mix(in srgb, var(--accent-primary) 5%, transparent)',
                  border:
                    '1px solid color-mix(in srgb, var(--accent-primary) 15%, transparent)',
                  color: 'var(--text-muted)',
                }}
              >
                All data is read-only. Mission Control does not control or
                interact with Claude Code — it only observes the JSONL transcript
                files that Claude Code writes to disk.
              </div>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function HelpCard({ entry }: { entry: (typeof HELP_ENTRIES)[number] }) {
  return (
    <div
      style={{
        borderRadius: '8px',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {/* Label */}
      <div
        className="px-4 py-2.5"
        style={{
          backgroundColor:
            'color-mix(in srgb, var(--accent-primary) 6%, transparent)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          className="font-mono text-xs font-bold tracking-wide"
          style={{ color: 'var(--accent-primary)' }}
        >
          {entry.label}
        </span>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        {/* What it shows */}
        <Row icon="●" label="What it shows" value={entry.whatItShows} />

        {/* Source */}
        <Row icon="◎" label="Source" value={entry.source} />

        {/* Formula — optional */}
        {entry.formula && (
          <div className="flex flex-col gap-1">
            <span
              className="font-mono text-[9px] uppercase tracking-widest"
              style={{ color: 'var(--text-muted)' }}
            >
              ƒ Formula
            </span>
            <code
              className="font-mono text-[11px] leading-relaxed block px-3 py-2 rounded"
              style={{
                backgroundColor:
                  'color-mix(in srgb, var(--foreground) 4%, transparent)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {entry.formula}
            </code>
          </div>
        )}

        {/* Caveats — optional */}
        {entry.caveats && (
          <div className="flex flex-col gap-1">
            <span
              className="font-mono text-[9px] uppercase tracking-widest"
              style={{ color: 'var(--text-muted)' }}
            >
              ⚑ Caveats
            </span>
            <p
              className="text-xs leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              {entry.caveats}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="font-mono text-[9px] uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
      >
        {icon} {label}
      </span>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {value}
      </p>
    </div>
  );
}
