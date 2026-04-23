'use client';

import type { Task } from '@/types';
import { STATUS_COLOR_VARS } from '@/lib/constants/taskStatus';
import { agentColor } from '@/lib/constants/agentColors';

interface TaskCardProps {
  task: Task;
  ownerColor?: string;
  onClick: () => void;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_LABELS: Record<Task['status'], string> = {
  pending: 'PENDING',
  in_progress: 'IN PROGRESS',
  completed: 'DONE',
  failed: 'FAILED',
};

export function TaskCard({ task, ownerColor, onClick }: TaskCardProps) {
  // Prefer explicit ownerColor prop (passed by Kanban column), then derive from owner name.
  const accentColor = ownerColor ?? agentColor(task.owner);
  const isBlocked = task.blockedBy.length > 0;
  const isInProgress = task.status === 'in_progress';
  const isCompleted = task.status === 'completed';

  return (
    <button
      onClick={onClick}
      className="lab-panel glow-hover w-full text-left transition-all duration-200 group"
      style={{
        // M18: left border colored by owner; full opacity on active cards
        borderLeft: `4px solid ${accentColor}`,
        padding: '10px 12px',
        cursor: 'pointer',
        // M18: completed tasks recede visually
        opacity: isCompleted ? 0.6 : 1,
      }}
      aria-label={`Task ${task.id}: ${task.subject}`}
    >
      {/* Top row: id + owner + blocked badge */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[10px]"
            style={{ color: 'var(--text-muted)' }}
          >
            #{task.id}
          </span>
          {task.owner && (
            <span
              className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm"
              style={{
                // M18: owner badge tinted at ~15% opacity with agent color
                backgroundColor: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
                color: accentColor,
                border: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
              }}
            >
              {task.owner}
            </span>
          )}
        </div>
        {isBlocked && (
          <span
            className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--danger) 12%, transparent)',
              color: 'var(--danger)',
              border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            }}
          >
            blocked·{task.blockedBy.length}
          </span>
        )}
      </div>

      {/* Subject */}
      <p
        className="text-sm font-medium leading-snug"
        style={{
          color: 'var(--foreground)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {task.subject}
      </p>

      {/* Bottom row: status + time */}
      <div className="flex items-center justify-between mt-2">
        <span
          className="font-mono text-[9px] uppercase tracking-wider"
          style={{ color: STATUS_COLOR_VARS[task.status] }}
        >
          {STATUS_LABELS[task.status]}
        </span>
        <span
          className="font-mono text-[10px]"
          style={{ color: 'var(--text-muted)' }}
        >
          {isCompleted && task.completedAt
            ? timeAgo(task.completedAt)
            : isInProgress
            ? `since ${timeAgo(task.updatedAt)}`
            : timeAgo(task.createdAt)}
        </span>
      </div>
    </button>
  );
}
