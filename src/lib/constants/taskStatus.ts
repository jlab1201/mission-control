import type { Task } from '@/types';

/**
 * Maps every Task status to the CSS variable string used for colour accents.
 * Single source of truth — used by TaskCard and TaskDetailDrawer.
 */
export const STATUS_COLOR_VARS: Record<Task['status'], string> = {
  pending: 'var(--text-muted)',
  in_progress: 'var(--accent-primary)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
};
