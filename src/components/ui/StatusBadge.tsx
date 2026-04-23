import { type AgentStatus } from '@/types';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: AgentStatus;
}

const STATUS_CONFIG: Record<
  AgentStatus,
  { dotClass: string; dotColorVar: string; label: string; textColorVar: string }
> = {
  active: {
    dotClass: 'pulse-green',
    dotColorVar: 'var(--success)',
    label: 'ACTIVE',
    textColorVar: 'var(--success)',
  },
  idle: {
    dotClass: '',
    dotColorVar: 'var(--text-muted)',
    label: 'IDLE',
    textColorVar: 'var(--text-muted)',
  },
  completed: {
    dotClass: '',
    dotColorVar: 'var(--accent-secondary)',
    label: 'DONE',
    textColorVar: 'var(--accent-secondary)',
  },
  failed: {
    dotClass: 'pulse-red',
    dotColorVar: 'var(--danger)',
    label: 'FAILED',
    textColorVar: 'var(--danger)',
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['idle'];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', config.dotClass)}
        style={{ backgroundColor: config.dotColorVar }}
      />
      <span
        className="font-mono text-xs tracking-widest uppercase"
        style={{ color: config.textColorVar }}
      >
        {config.label}
      </span>
    </span>
  );
}
