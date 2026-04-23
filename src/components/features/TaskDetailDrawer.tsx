'use client';

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { EventsTimeline } from '@/components/features/EventsTimeline';
import type { Agent, AgentEvent, Task } from '@/types';
import { watchAgent } from '@/lib/api/agents';
import { STATUS_COLOR_VARS } from '@/lib/constants/taskStatus';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface TaskDetailDrawerProps {
  taskId: string | null;
  tasks: Task[];
  agents: Agent[];
  events: AgentEvent[];
  onClose: () => void;
  onNavigateToTask?: (id: string) => void;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function duration(start: string, end?: string): string {
  const endMs = end ? new Date(end).getTime() : Date.now();
  const ms = endMs - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const LS_KEY = 'mc.drawerWidth';

function readPersistedWidth(): number {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n >= MIN_WIDTH) return n;
    }
  } catch {
    // localStorage unavailable (SSR / private mode)
  }
  return DEFAULT_WIDTH;
}

export function TaskDetailDrawer({
  taskId,
  tasks,
  agents,
  events,
  onClose,
  onNavigateToTask,
}: TaskDetailDrawerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [watchStatus, setWatchStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [watchError, setWatchError] = useState('');

  // M19: resizable width — initialised lazily from localStorage
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_WIDTH);

  // Read persisted width only on client (avoid SSR mismatch)
  useEffect(() => {
    setWidth(readPersistedWidth());
  }, []);

  // M19: max width bound at 80vw — computed on drag not at render so it's always current
  const maxWidth = useCallback(() => Math.floor(window.innerWidth * 0.8), []);

  const handleDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = width;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      // Dragging the LEFT edge: moving pointer left → wider drawer
      const delta = dragStartX.current - e.clientX;
      const next = Math.min(maxWidth(), Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      setWidth(next);
    },
    [maxWidth],
  );

  const handleDragEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      const delta = dragStartX.current - e.clientX;
      const final = Math.min(maxWidth(), Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      setWidth(final);
      try {
        localStorage.setItem(LS_KEY, String(final));
      } catch {
        // ignore
      }
    },
    [maxWidth],
  );

  const handleDragDoubleClick = useCallback(() => {
    setWidth(DEFAULT_WIDTH);
    try {
      localStorage.setItem(LS_KEY, String(DEFAULT_WIDTH));
    } catch {
      // ignore
    }
  }, []);

  const drawerRef = useRef<HTMLElement>(null);
  const isOpen = taskId !== null;

  useFocusTrap(drawerRef, isOpen);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const task = taskId ? tasks.find((t) => t.id === taskId) : null;

  const taskIndex = taskId ? tasks.findIndex((t) => t.id === taskId) : -1;
  const prevTask = taskIndex > 0 ? tasks[taskIndex - 1] : null;
  const nextTask =
    taskIndex >= 0 && taskIndex < tasks.length - 1 ? tasks[taskIndex + 1] : null;

  useEffect(() => {
    if (!taskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && prevTask) {
        onNavigateToTask?.(prevTask.id);
      } else if (e.key === 'ArrowRight' && nextTask) {
        onNavigateToTask?.(nextTask.id);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [taskId, prevTask, nextTask, onNavigateToTask]);

  if (!task) return null;

  const ownerAgent = task.owner
    ? agents.find(
        (a) => a.name === task.owner || a.subagentType === task.owner,
      )
    : null;

  const agentEvents = ownerAgent
    ? events.filter((e) => e.agentId === ownerAgent.id).slice(0, 5)
    : [];

  const blockedByTasks = task.blockedBy
    .map((id) => tasks.find((t) => t.id === id))
    .filter(Boolean) as Task[];

  const blocksTasks = task.blocks
    .map((id) => tasks.find((t) => t.id === id))
    .filter(Boolean) as Task[];

  const handleWatch = async () => {
    if (!ownerAgent) return;
    setWatchStatus('loading');
    setWatchError('');
    try {
      await watchAgent(ownerAgent.id);
      setWatchStatus('done');
      setTimeout(() => setWatchStatus('idle'), 3000);
    } catch (err) {
      setWatchError(err instanceof Error ? err.message : 'Error');
      setWatchStatus('error');
      setTimeout(() => setWatchStatus('idle'), 4000);
    }
  };

  const accentColor = ownerAgent?.color ?? 'var(--accent-primary)';

  return (
    <>
      {/* Transparent backdrop — catches click-outside to dismiss the drawer */}
      <motion.div
        className="fixed inset-0 z-40"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      />

      {/* Drawer */}
      <motion.aside
        ref={drawerRef}
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col overflow-hidden"
        style={{
          width: `${width}px`,
          maxWidth: '100vw',
          backgroundColor: 'color-mix(in srgb, var(--background) 97%, transparent)',
          borderLeft: '1px solid var(--border)',
          backdropFilter: 'blur(20px)',
          outline: 'none',
        }}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
      >
        {/* M19: drag handle — left edge, 4px wide, col-resize cursor */}
        <div
          className="absolute top-0 left-0 bottom-0 z-10"
          style={{
            width: '8px',
            cursor: 'col-resize',
            // Slightly wider hit-target than the visual 4px stripe
          }}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          onDoubleClick={handleDragDoubleClick}
          aria-label="Resize drawer"
          role="separator"
          aria-orientation="vertical"
        >
          {/* Visual indicator bar */}
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: '3px',
              width: '2px',
              backgroundColor: 'var(--border)',
              opacity: 0.5,
              transition: 'opacity 150ms ease, background-color 150ms ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.opacity = '1';
              (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--accent-primary)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.opacity = '0.5';
              (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--border)';
            }}
          />
        </div>

        {/* Accent top border */}
        <div
          className="h-[2px] w-full flex-shrink-0"
          style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
        />

        {/* Header */}
        <div
          className="flex items-start justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          {/* M19 content reflow: min-w-0 + flex-1 so title doesn't push drawer wide */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                #{task.id}
              </span>
              <span
                className="font-mono text-[10px]"
                style={{ color: 'var(--text-muted)' }}
              >
                {taskIndex + 1}/{tasks.length}
              </span>
            </div>
            <h2
              id="drawer-title"
              className="text-base font-semibold leading-snug mt-0.5 break-words"
              style={{ color: 'var(--foreground)' }}
            >
              {task.subject}
            </h2>
          </div>
          <div className="ml-4 flex items-center gap-1 flex-shrink-0">
            <NavButton
              direction="prev"
              onClick={() => prevTask && onNavigateToTask?.(prevTask.id)}
              disabled={!prevTask}
              label={prevTask ? `Previous task #${prevTask.id}` : 'No previous task'}
            />
            <NavButton
              direction="next"
              onClick={() => nextTask && onNavigateToTask?.(nextTask.id)}
              disabled={!nextTask}
              label={nextTask ? `Next task #${nextTask.id}` : 'No next task'}
            />
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--foreground)';
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'color-mix(in srgb, var(--foreground) 6%, transparent)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
              }}
              aria-label="Close drawer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body — scrollable; M19 reflow: min-w-0, no fixed widths */}
        <div className="flex-1 overflow-y-auto min-w-0 px-6 py-4 flex flex-col gap-5">
          {/* Meta stack: owner, status, (created · updated · duration) */}
          <div className="flex flex-col gap-3">
            <MetaRow
              label="owner"
              value={task.owner ?? 'main'}
              color={task.owner ? accentColor : 'var(--text-secondary)'}
            />
            <MetaRow
              label="status"
              value={task.status.replace('_', ' ')}
              color={STATUS_COLOR_VARS[task.status]}
            />
            <div className="grid grid-cols-3 gap-3">
              <MetaRow label="created" value={timeAgo(task.createdAt)} />
              <MetaRow label="updated" value={timeAgo(task.updatedAt)} />
              <MetaRow
                label="duration"
                value={duration(task.createdAt, task.completedAt)}
              />
            </div>
          </div>

          {/* Description */}
          {task.description && (
            <Section title="Description">
              <p
                className="text-sm leading-relaxed break-words min-w-0"
                style={{
                  color: 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap',
                  textAlign: 'justify',
                  hyphens: 'auto',
                  wordBreak: 'break-word',
                }}
              >
                {task.description}
              </p>
            </Section>
          )}

          {/* Active form — M19 reflow: overflow-x-auto within container, never pushes drawer */}
          {task.activeForm && (
            <Section title="Active Form">
              <div className="min-w-0 overflow-x-auto">
                <pre
                  className="text-xs font-mono leading-relaxed rounded p-3"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--accent-primary) 4%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent-primary) 15%, transparent)',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {task.activeForm}
                </pre>
              </div>
            </Section>
          )}

          {/* Dependencies */}
          {(blockedByTasks.length > 0 || blocksTasks.length > 0) && (
            <Section title="Dependencies">
              {blockedByTasks.length > 0 && (
                <div className="mb-2">
                  <span
                    className="font-mono text-[10px] uppercase tracking-wider block mb-1.5"
                    style={{ color: 'var(--danger)' }}
                  >
                    blocked by
                  </span>
                  <div className="flex flex-col gap-1">
                    {blockedByTasks.map((t) => (
                      <DependencyChip
                        key={t.id}
                        task={t}
                        color="var(--danger)"
                        onClick={() => onNavigateToTask?.(t.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {blocksTasks.length > 0 && (
                <div>
                  <span
                    className="font-mono text-[10px] uppercase tracking-wider block mb-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    blocks
                  </span>
                  <div className="flex flex-col gap-1">
                    {blocksTasks.map((t) => (
                      <DependencyChip
                        key={t.id}
                        task={t}
                        color="var(--text-secondary)"
                        onClick={() => onNavigateToTask?.(t.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Associated agent */}
          {ownerAgent && (
            <Section title="Agent">
              <div className="lab-panel p-3 min-w-0">
                <div className="flex items-center justify-between mb-3 gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor:
                          ownerAgent.status === 'active'
                            ? accentColor
                            : 'var(--border-strong)',
                      }}
                    />
                    <span
                      className="font-mono text-xs font-bold truncate"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {ownerAgent.subagentType ?? ownerAgent.name}
                    </span>
                    <span
                      className="font-mono text-[10px] flex-shrink-0"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {ownerAgent.phase}
                    </span>
                  </div>
                  <button
                    onClick={handleWatch}
                    disabled={watchStatus === 'loading'}
                    className="font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded transition-all flex-shrink-0"
                    style={{
                      backgroundColor:
                        watchStatus === 'done'
                          ? 'color-mix(in srgb, var(--success) 12%, transparent)'
                          : watchStatus === 'error'
                          ? 'color-mix(in srgb, var(--danger) 12%, transparent)'
                          : 'color-mix(in srgb, var(--accent-primary) 8%, transparent)',
                      color:
                        watchStatus === 'done'
                          ? 'var(--success)'
                          : watchStatus === 'error'
                          ? 'var(--danger)'
                          : 'var(--accent-primary)',
                      border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)',
                      cursor: watchStatus === 'loading' ? 'wait' : 'pointer',
                    }}
                    title={watchStatus === 'error' ? watchError : 'Open tmux window'}
                  >
                    {watchStatus === 'loading'
                      ? '...'
                      : watchStatus === 'done'
                      ? 'opened ✓'
                      : watchStatus === 'error'
                      ? `error: ${watchError.slice(0, 20)}`
                      : 'watch live ▶'}
                  </button>
                </div>

                {agentEvents.length > 0 && (
                  <div>
                    <span
                      className="font-mono text-[9px] uppercase tracking-widest block mb-2"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      recent activity
                    </span>
                    <EventsTimeline events={agentEvents} maxItems={5} />
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Raw JSON collapsible — M19 reflow: overflow-x-auto so long lines scroll */}
          <div className="min-w-0">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="font-mono text-[10px] uppercase tracking-widest flex items-center gap-2 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
              }}
              aria-expanded={showRaw}
            >
              <span>{showRaw ? '▼' : '▶'}</span>
              raw json
            </button>
            {showRaw && (
              <div className="mt-2 min-w-0 overflow-x-auto">
                <pre
                  className="text-[10px] font-mono leading-relaxed rounded p-3"
                  style={{
                    backgroundColor: 'var(--surface-sunken)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                    whiteSpace: 'pre',
                    // Allow long lines to scroll horizontally within the container
                  }}
                >
                  {JSON.stringify(task, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </motion.aside>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h3
        className="font-mono text-[10px] uppercase tracking-widest mb-2"
        style={{ color: 'var(--text-muted)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function MetaRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-start min-w-0 overflow-hidden">
      <span
        className="font-mono text-[9px] uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </span>
      <span
        className="font-mono text-xs mt-0.5 break-words max-w-full"
        style={{ color: color ?? 'var(--text-secondary)' }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function NavButton({
  direction,
  onClick,
  disabled,
  label,
}: {
  direction: 'prev' | 'next';
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-7 h-7 flex items-center justify-center rounded font-mono text-xs transition-colors"
      style={{
        color: disabled ? 'var(--border-strong)' : 'var(--text-muted)',
        border: '1px solid var(--border)',
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--foreground)';
        (e.currentTarget as HTMLButtonElement).style.borderColor =
          'var(--accent-primary)';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
        (e.currentTarget as HTMLButtonElement).style.borderColor =
          'var(--border)';
      }}
    >
      {direction === 'prev' ? '◀' : '▶'}
    </button>
  );
}

function DependencyChip({
  task,
  color,
  onClick,
}: {
  task: Task;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="glow-hover text-left flex items-center gap-2 px-2 py-1.5 rounded w-full transition-colors min-w-0 overflow-hidden"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--foreground) 3%, transparent)',
        border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
        cursor: onClick ? 'pointer' : 'default',
      }}
      aria-label={`Dependency task ${task.id}`}
    >
      <span
        className="font-mono text-[10px] flex-shrink-0"
        style={{ color: `color-mix(in srgb, ${color} 53%, transparent)` }}
      >
        #{task.id}
      </span>
      <span
        className="text-xs truncate min-w-0"
        style={{ color: 'var(--text-secondary)' }}
      >
        {task.subject}
      </span>
    </button>
  );
}
