'use client';

import { useMissionStore, selectActiveAgents, selectTasksByStatus } from '@/lib/store/missionStore';
import type { Agent, Task, TaskStatus } from '@/types';

/**
 * Convenience selector hooks for the frontend team.
 * These provide memoized, stable accessors without exposing internal store shape.
 */

export function useActiveAgents(): Agent[] {
  return useMissionStore(selectActiveAgents);
}

export function useTasksByStatus(status: TaskStatus): Task[] {
  return useMissionStore((s) => selectTasksByStatus(s, status));
}

export function useAgentById(id: string | null): Agent | null {
  return useMissionStore((s) => (id ? (s.agents[id] ?? null) : null));
}

export function useTaskById(id: string | null): Task | null {
  return useMissionStore((s) => (id ? (s.tasks[id] ?? null) : null));
}

export function useMissionMeta() {
  return useMissionStore((s) => s.mission);
}
