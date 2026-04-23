'use client';

import { type ReactNode } from 'react';
import { useSSE } from '@/hooks/useSSE';

interface DashboardProviderProps {
  children: ReactNode;
}

/**
 * Intentionally scoped to src/app/page.tsx (not root layout.tsx) so the SSE
 * connection only opens on the dashboard route, not on every page.
 *
 * Mounts the SSE connection and hydrates the mission store.
 * All children can consume the store via useMissionStore().
 */
export function DashboardProvider({ children }: DashboardProviderProps) {
  useSSE('/api/stream');

  return <>{children}</>;
}
