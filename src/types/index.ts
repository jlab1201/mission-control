// Re-export HostInfo here so src/types is the canonical shared location.
// hostRegistry imports it back from here to avoid circular deps.
export interface HostInfo {
  hostId: string;
  hostLabel?: string;
  hostname?: string;
  ipAddress?: string;
  watchedProjectPath?: string;
  registeredAt: string;    // ISO — first time the entry appeared
  lastPostedAt?: string;   // ISO — undefined means the reporter has never posted yet
  manuallyAdded: boolean;
}

export type AgentType = 'main' | 'subagent' | 'team';
export type AgentStatus = 'active' | 'idle' | 'completed' | 'failed';
export type AgentPhase = 'spawning' | 'exploring' | 'implementing' | 'reporting' | 'done';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface Agent {
  id: string;                       // 'main' or subagent agentId
  type: AgentType;
  name: string;                     // 'main' for parent, or Agent tool `input.name` ('backend', etc.)
  subagentType?: string;            // Agent tool `input.subagent_type` ('backend-dev', etc.)
  description?: string;             // Agent tool `input.description`
  model?: string;
  status: AgentStatus;
  phase: AgentPhase;
  startedAt: string;
  lastActiveAt: string;
  toolUseCount: number;
  lastAction?: string;              // e.g., "Edit src/app/page.tsx"
  transcriptPath: string;           // absolute file path — used by watch-live endpoint
  spawnPromptPreview?: string;      // first ~500 chars
  color?: string;                   // optional UI color tag
  recentToolUseTimestamps: string[]; // ISO timestamps within last 60s — for velocity sparkline
  parentAgentId?: string;           // 'main' or parent subagent id; used to render hierarchical titles
  parentAgentLabel?: string;        // short label of the parent — e.g., 'main', 'frontend-dev'
  tokensIn: number;                 // cumulative uncached input tokens
  tokensOut: number;                // cumulative output tokens
  cacheCreateTokens: number;        // cumulative cache-creation input tokens
  cacheReadTokens: number;          // cumulative cache-read input tokens
  estCostUsd: number;               // cumulative estimated cost in USD (0 if model unknown)
  hostId: string;                   // stable short identifier for the host, e.g. "laptop", "local"
  hostLabel?: string;               // optional human-friendly display name for the host
  /**
   * Total milliseconds this agent has spent in 'active' status, accumulated
   * across all active streaks. Persists across MC restarts via the snapshot
   * file. Used to render an agent's lifetime work duration that pauses
   * (instead of resetting) whenever the agent goes idle/completed.
   */
  workDurationMs: number;
  /**
   * ISO timestamp when the current active streak started, or null when the
   * agent is not currently active. The dashboard ticks the displayed
   * duration only while this is non-null.
   */
  activeStreakStart: string | null;
}

/** Agent shape safe for HTTP responses — internal fs paths are stripped. */
export type PublicAgent = Omit<Agent, 'transcriptPath'>;

/** Strip server-internal fields before serialising an Agent to an HTTP response. */
export function toPublicAgent({ transcriptPath: _t, ...rest }: Agent): PublicAgent {
  return rest;
}

export interface AgentDefinition {
  /** Agent handle — from frontmatter `name` or a deterministic codename if missing. */
  name: string;
  /** Short role label — first sentence of description, truncated. */
  role: string;
  /** Full description from frontmatter. */
  description: string;
  model?: string;
  color?: string;
}

export interface Task {
  id: string;                       // "1", "2" ... from Claude Code task runtime
  subject: string;
  description?: string;
  activeForm?: string;
  status: TaskStatus;
  owner?: string;
  blockedBy: string[];
  blocks: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  createdByToolUseId?: string;      // the toolu_XXX for traceability
}

export interface AgentEvent {
  seq: number;
  id: string;                       // event unique ID
  agentId: string;
  agentName: string;
  type: 'agent_spawn' | 'agent_complete' | 'task_create' | 'task_update' | 'tool_use' | 'message';
  toolName?: string;
  summary: string;                  // human-readable one-liner
  details?: Record<string, unknown>;
  timestamp: string;
  hostId: string;                   // host that produced this event
  hostLabel?: string;               // optional human-friendly display name for the host
}

export interface MissionStats {
  totalTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  activeAgents: number;
  totalAgents: number;
  toolUseCount: number;
  velocityPer10Min: number;         // tasks completed / 10 min rolling
  sessionUptimeSeconds: number;
  lastEventAt?: string;
  hosts: Array<{
    hostId: string;
    hostLabel?: string;
    lastSeenAt: string;
    agentCount: number;
    activeAgentCount: number;
  }>;
  /**
   * Mission-level accumulated work duration: total ms during which at least
   * one local agent was active. Pauses when every agent is idle/completed.
   */
  missionWorkDurationMs: number;
  /**
   * ISO timestamp when the mission's current active streak started, or null
   * when no agent is currently active.
   */
  missionActiveSince: string | null;
}

export interface MissionSnapshot {
  mission: {
    sessionId: string;
    cwd: string;
    startedAt: string;
    model?: string;
  };
  agents: Agent[];
  tasks: Task[];
  events: AgentEvent[];             // last 200
  stats: MissionStats;
  lastSeq: number;
}

/**
 * Persistent snapshot written to ~/.mission-control/state/<slug>.json.
 * Allows registry state to survive dev-server reloads and project switches.
 */
export interface RegistrySnapshot {
  version: 1 | 2;
  savedAt: string;           // ISO timestamp
  sessionId: string | null;
  cwd: string | null;
  lastSeq: number;
  agents: Agent[];           // materialized from the Map
  tasks: Task[];             // materialized from the Map
  events: AgentEvent[];      // last 500 from the ring buffer
  knownHosts?: HostInfo[];   // optional — absent in older v2 snapshots
  /** Mission-level accumulated work duration (ms). Optional for back-compat. */
  missionWorkDurationMs?: number;
  /** Mission-level current active-streak start, or null. Optional for back-compat. */
  missionActiveSince?: string | null;
}

// SSE message union (internal — agents carry transcriptPath)
export type SSEMessage =
  | { type: 'snapshot'; payload: MissionSnapshot }
  | { type: 'agent:update'; seq: number; payload: Agent }
  | { type: 'agent:delete'; seq: number; payload: { id: string } }
  | { type: 'task:replace'; seq: number; payload: Task }
  | { type: 'event:new'; seq: number; payload: AgentEvent }
  | { type: 'stats:update'; seq: number; payload: MissionStats }
  | { type: 'ping' };

/** Wire-safe MissionSnapshot — transcriptPath stripped from all agents. */
export interface PublicMissionSnapshot extends Omit<MissionSnapshot, 'agents'> {
  agents: PublicAgent[];
}

/** Wire-safe SSE message union — transcriptPath stripped wherever Agent appears. */
export type PublicSSEMessage =
  | { type: 'snapshot'; payload: PublicMissionSnapshot }
  | { type: 'agent:update'; seq: number; payload: PublicAgent }
  | { type: 'agent:delete'; seq: number; payload: { id: string } }
  | { type: 'task:replace'; seq: number; payload: Task }
  | { type: 'event:new'; seq: number; payload: AgentEvent }
  | { type: 'stats:update'; seq: number; payload: MissionStats }
  | { type: 'ping' };

/** Strip transcriptPath from an SSEMessage before writing to the wire. */
export function toPublicSSEMessage(msg: SSEMessage): PublicSSEMessage {
  if (msg.type === 'snapshot') {
    return {
      ...msg,
      payload: { ...msg.payload, agents: msg.payload.agents.map(toPublicAgent) },
    };
  }
  if (msg.type === 'agent:update') {
    return { ...msg, payload: toPublicAgent(msg.payload) };
  }
  return msg;
}

export interface ApiResponse<T> { data: T; }

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}
export interface ApiErrorResponse {
  error: ApiErrorBody;
}
/** @deprecated Use ApiErrorResponse instead */
export interface ApiError { error: ApiErrorBody; }
