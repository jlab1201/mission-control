'use client';

import type { AgentEvent } from '@/types';

interface EventsTimelineProps {
  events: AgentEvent[];
  onEventClick?: (event: AgentEvent) => void;
  maxItems?: number;
}

const EVENT_TYPE_COLOR_VARS: Record<AgentEvent['type'], string> = {
  agent_spawn: 'var(--success)',
  agent_complete: 'var(--success)',
  task_create: 'var(--accent-primary)',
  task_update: 'var(--accent-primary)',
  tool_use: 'var(--text-secondary)',
  message: 'var(--text-muted)',
};

const EVENT_TYPE_ICONS: Record<AgentEvent['type'], string> = {
  agent_spawn: '⟳',
  agent_complete: '✓',
  task_create: '+',
  task_update: '↻',
  tool_use: '⚙',
  message: '◆',
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function EventsTimeline({
  events,
  onEventClick,
  maxItems = 20,
}: EventsTimelineProps) {
  const visible = events.slice(0, maxItems);

  if (visible.length === 0) {
    return (
      <div
        className="py-6 text-center font-mono text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        no events yet
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0" role="log" aria-live="polite" aria-label="Event timeline">
      {visible.map((event) => {
        const colorVar = EVENT_TYPE_COLOR_VARS[event.type];
        const icon = EVENT_TYPE_ICONS[event.type];
        const isInteractive = !!onEventClick;

        return (
          <div
            key={event.id}
            role={isInteractive ? 'button' : undefined}
            tabIndex={isInteractive ? 0 : undefined}
            onClick={isInteractive ? () => onEventClick(event) : undefined}
            onKeyDown={
              isInteractive
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') onEventClick(event);
                  }
                : undefined
            }
            className={`flex items-start gap-3 py-2 px-1 rounded transition-colors duration-150 ${isInteractive ? 'glow-hover' : ''}`}
            style={{
              cursor: isInteractive ? 'pointer' : 'default',
              borderBottom: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
            }}
          >
            {/* Icon + line */}
            <div className="flex flex-col items-center gap-0 flex-shrink-0 mt-0.5">
              <span
                className="font-mono text-xs leading-none"
                style={{ color: colorVar, width: '14px', textAlign: 'center' }}
              >
                {icon}
              </span>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className="font-mono text-[10px] text-ellipsis overflow-hidden whitespace-nowrap"
                  style={{ color: 'var(--text-secondary)', maxWidth: '100px' }}
                >
                  {event.agentName}
                </span>
                <span
                  className="font-mono text-[9px] flex-shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {timeAgo(event.timestamp)}
                </span>
              </div>
              <p
                className="text-xs mt-0.5 leading-snug"
                style={{ color: 'var(--foreground)' }}
              >
                {event.summary}
              </p>
              {event.toolName && (
                <span
                  className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm mt-1 inline-block"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--accent-primary) 8%, transparent)',
                    color: 'color-mix(in srgb, var(--accent-primary) 60%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)',
                  }}
                >
                  {event.toolName}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
