'use client';

import { TaskCard } from '@/components/features/TaskCard';
import type { Agent, Task, TaskStatus } from '@/types';

interface TaskKanbanProps {
  tasks: Task[];
  agents: Agent[];
  onOpenTask: (id: string) => void;
}

const COLUMNS: { status: TaskStatus; label: string; colorVar: string }[] = [
  { status: 'pending', label: 'PENDING', colorVar: 'var(--text-muted)' },
  { status: 'in_progress', label: 'IN PROGRESS', colorVar: 'var(--accent-primary)' },
  { status: 'completed', label: 'COMPLETED', colorVar: 'var(--success)' },
];

function EmptyColumn({ label }: { label: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-12 rounded"
      style={{ border: '1px dashed color-mix(in srgb, var(--border) 50%, transparent)' }}
    >
      <span
        className="font-mono text-xs uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
      >
        no {label.toLowerCase()} tasks
      </span>
    </div>
  );
}

export function TaskKanban({ tasks, agents, onOpenTask }: TaskKanbanProps) {
  // Build owner → color map from agents
  const ownerColorMap: Record<string, string> = {};
  for (const agent of agents) {
    if (agent.color) {
      ownerColorMap[agent.name] = agent.color;
      if (agent.subagentType) {
        ownerColorMap[agent.subagentType] = agent.color;
      }
    }
  }

  const tasksByStatus = (status: TaskStatus) =>
    tasks.filter((t) => t.status === status);

  return (
    <div
      className="flex-1 grid grid-cols-3 gap-4 px-6 py-4 overflow-hidden"
      role="region"
      aria-label="Task board"
    >
      {COLUMNS.map(({ status, label, colorVar }) => {
        const columnTasks = tasksByStatus(status);
        return (
          <div
            key={status}
            className="flex flex-col min-h-0"
            role="group"
            aria-label={label}
          >
            {/* Column header */}
            <div
              className="flex items-center justify-between mb-3 pb-2 flex-shrink-0"
              style={{ borderBottom: `1px solid color-mix(in srgb, var(--border) 60%, transparent)` }}
            >
              <span
                className="font-mono text-xs uppercase tracking-widest font-bold"
                style={{ color: colorVar }}
              >
                {label}
              </span>
              <span
                className="font-mono text-xs px-2 py-0.5 rounded-sm"
                style={{
                  backgroundColor: `color-mix(in srgb, ${colorVar} 10%, transparent)`,
                  color: colorVar,
                  border: `1px solid color-mix(in srgb, ${colorVar} 25%, transparent)`,
                }}
              >
                {columnTasks.length}
              </span>
            </div>

            {/* Column body — scrollable */}
            <div className="flex flex-col gap-2 overflow-y-auto flex-1">
              {columnTasks.length === 0 ? (
                <EmptyColumn label={label} />
              ) : (
                columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    ownerColor={task.owner ? ownerColorMap[task.owner] : undefined}
                    onClick={() => onOpenTask(task.id)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
