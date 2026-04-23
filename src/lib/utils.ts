import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function getAgentColor(color: string | undefined): string {
  const map: Record<string, string> = {
    purple: '#a855f7',
    blue: '#3b82f6',
    green: '#22c55e',
    orange: '#f97316',
    yellow: '#eab308',
    red: '#ef4444',
    cyan: '#06b6d4',
  };
  return (color != null ? map[color] : undefined) ?? '#64748b';
}

export function getContextHealthColor(health: string): string {
  const map: Record<string, string> = {
    GREEN: '#39ff14',
    YELLOW: '#ffb800',
    ORANGE: '#f97316',
    RED: '#ff3b5c',
  };
  return map[health] ?? '#64748b';
}

/**
 * Strips common role suffixes so e.g. "frontend-dev" reads as "frontend"
 * in breadcrumb / hierarchy displays.
 */
export function shortRole(role?: string): string {
  if (!role) return '';
  return role.replace(/-(dev|engineer|specialist)$/i, '');
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    active: '#39ff14',
    idle: '#4a5568',
    error: '#ff3b5c',
    compacting: '#ffb800',
    waiting: '#667eea',
  };
  return map[status] ?? '#4a5568';
}
