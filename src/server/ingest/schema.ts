import { z } from 'zod';

const HOST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_STR = 4096;

const ISODateString = z.string().min(1).max(64);

const AgentIngestSchema = z
  .object({
    id: z.string().min(1).max(256),
    type: z.enum(['main', 'subagent', 'team']),
    name: z.string().min(1).max(256),
    subagentType: z.string().max(256).optional(),
    description: z.string().max(MAX_STR).optional(),
    model: z.string().max(256).optional(),
    status: z.enum(['active', 'idle', 'completed', 'failed']),
    phase: z.enum(['spawning', 'exploring', 'implementing', 'reporting', 'done']),
    startedAt: ISODateString,
    lastActiveAt: ISODateString,
    toolUseCount: z.number().int().min(0),
    lastAction: z.string().max(MAX_STR).optional(),
    transcriptPath: z
      .string()
      .max(MAX_STR)
      .refine(
        (p) => !p.split('/').some((seg) => seg === '..'),
        { message: 'transcriptPath must not contain path traversal segments' },
      ),
    spawnPromptPreview: z.string().max(MAX_STR).optional(),
    color: z.string().max(64).optional(),
    recentToolUseTimestamps: z.array(ISODateString).max(200),
    parentAgentId: z.string().max(256).optional(),
    parentAgentLabel: z.string().max(256).optional(),
    tokensIn: z.number().min(0),
    tokensOut: z.number().min(0),
    cacheCreateTokens: z.number().min(0),
    cacheReadTokens: z.number().min(0),
    estCostUsd: z.number().min(0),
    hostId: z.string().optional(),
    hostLabel: z.string().optional(),
  })
  .strict();

const AgentEventIngestSchema = z
  .object({
    id: z.string().min(1).max(256),
    agentId: z.string().min(1).max(256),
    agentName: z.string().min(1).max(256),
    type: z.enum([
      'agent_spawn',
      'agent_complete',
      'task_create',
      'task_update',
      'tool_use',
      'message',
    ]),
    toolName: z.string().max(256).optional(),
    summary: z.string().max(MAX_STR),
    details: z.record(z.unknown()).optional(),
    timestamp: ISODateString,
    seq: z.number().int().optional(),
    hostId: z.string().optional(),
    hostLabel: z.string().optional(),
  })
  .strict();

const TaskIngestSchema = z
  .object({
    id: z.string().min(1).max(256),
    subject: z.string().max(MAX_STR),
    description: z.string().max(MAX_STR).optional(),
    activeForm: z.string().max(MAX_STR).optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    owner: z.string().max(256).optional(),
    blockedBy: z.array(z.string().max(256)).max(200),
    blocks: z.array(z.string().max(256)).max(200),
    createdAt: ISODateString,
    updatedAt: ISODateString,
    completedAt: ISODateString.optional(),
    createdByToolUseId: z.string().max(256).optional(),
  })
  .strict();

export const IngestPayloadBodySchema = z
  .object({
    agents: z.array(AgentIngestSchema).max(500).optional(),
    events: z.array(AgentEventIngestSchema).max(1000).optional(),
    tasks: z.array(TaskIngestSchema).max(500).optional(),
    removedAgentIds: z.array(z.string().max(256)).max(500).optional(),
  })
  .strict();

export const IngestPayloadSchema = z
  .object({
    hostId: z.string().regex(HOST_ID_REGEX, 'hostId must match /^[a-zA-Z0-9_-]{1,64}$/'),
    hostLabel: z.string().max(64).optional(),
    watchedProjectPath: z.string().max(4096).optional(),
    mode: z.enum(['snapshot', 'delta']),
    payload: IngestPayloadBodySchema,
  })
  .strict();

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;
export type AgentIngest = z.infer<typeof AgentIngestSchema>;
export type AgentEventIngest = z.infer<typeof AgentEventIngestSchema>;
export type TaskIngest = z.infer<typeof TaskIngestSchema>;

export { AgentIngestSchema, AgentEventIngestSchema, TaskIngestSchema };
