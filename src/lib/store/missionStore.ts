import { create } from 'zustand';
import type { Agent, AgentDefinition, AgentEvent, MissionSnapshot, MissionStats, Task, TaskStatus } from '@/types';
import { CLIENT_EVENT_LIMIT } from '@/lib/config/runtime';

export interface MissionState {
  // Data — flat records for easy lookup
  agents: Record<string, Agent>;
  tasks: Record<string, Task>;
  events: AgentEvent[];                          // newest first, cap 200
  stats: MissionStats | null;
  mission: MissionSnapshot['mission'] | null;
  lastSeq: number;
  agentDefinitions: AgentDefinition[];           // loaded from /api/agent-definitions

  // Host filter
  selectedHostId: string | null;                 // null = "All hosts"

  // Connection
  sseStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  lastEventReceivedAt: string | null;            // used by HeartbeatIndicator

  // Actions
  hydrateFromSnapshot: (snapshot: MissionSnapshot) => void;
  upsertAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  upsertTask: (task: Task) => void;
  addEvent: (event: AgentEvent) => void;
  setStats: (stats: MissionStats) => void;
  setAgentDefinitions: (defs: AgentDefinition[]) => void;
  setSseStatus: (status: MissionState['sseStatus']) => void;
  touchLastReceived: () => void;
  setSelectedHostId: (id: string | null) => void;
}

export const useMissionStore = create<MissionState>((set) => ({
  agents: {},
  tasks: {},
  events: [],
  stats: null,
  mission: null,
  lastSeq: 0,
  agentDefinitions: [],
  selectedHostId: null,
  sseStatus: 'connecting',
  lastEventReceivedAt: null,

  hydrateFromSnapshot: (snapshot) =>
    set({
      mission: snapshot.mission,
      agents: Object.fromEntries(snapshot.agents.map((a) => [a.id, a])),
      tasks: Object.fromEntries(snapshot.tasks.map((t) => [t.id, t])),
      events: snapshot.events,
      stats: snapshot.stats,
      lastSeq: snapshot.lastSeq,
    }),

  upsertAgent: (agent) =>
    set((state) => ({
      agents: { ...state.agents, [agent.id]: agent },
    })),

  removeAgent: (id) =>
    set((state) => {
      if (!(id in state.agents)) return {};
      const next = { ...state.agents };
      delete next[id];
      return { agents: next };
    }),

  upsertTask: (task) =>
    set((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
    })),

  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events].slice(0, CLIENT_EVENT_LIMIT),
      lastSeq: event.seq > state.lastSeq ? event.seq : state.lastSeq,
    })),

  setStats: (stats) => set({ stats }),

  setAgentDefinitions: (agentDefinitions) => set({ agentDefinitions }),

  setSseStatus: (sseStatus) => set({ sseStatus }),

  touchLastReceived: () => set({ lastEventReceivedAt: new Date().toISOString() }),

  setSelectedHostId: (selectedHostId) => set({ selectedHostId }),
}));

// ---------------------------------------------------------------------------
// Selectors — exported separately, NOT in store, to avoid re-render traps
// ---------------------------------------------------------------------------

export function selectAgentsArray(s: MissionState): Agent[] {
  return Object.values(s.agents);
}

export function selectTasksArray(s: MissionState): Task[] {
  return Object.values(s.tasks);
}

export function selectActiveAgents(s: MissionState): Agent[] {
  return Object.values(s.agents).filter((a) => a.status === 'active');
}

export function selectTasksByStatus(s: MissionState, status: TaskStatus): Task[] {
  return Object.values(s.tasks).filter((t) => t.status === status);
}

export function selectHosts(s: MissionState): MissionStats['hosts'] {
  return s.stats?.hosts ?? [];
}

export function selectFilteredAgents(s: MissionState): Agent[] {
  const all = Object.values(s.agents);
  if (s.selectedHostId == null) return all;
  return all.filter((a) => a.hostId === s.selectedHostId);
}

export function selectFilteredEvents(s: MissionState): AgentEvent[] {
  if (s.selectedHostId == null) return s.events;
  return s.events.filter((e) => e.hostId === s.selectedHostId);
}
