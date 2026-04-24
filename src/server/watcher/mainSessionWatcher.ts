import { randomUUID } from 'crypto';
import { statSync } from 'fs';
import {
  parseJsonlLines,
  extractToolUses,
  extractToolResults,
  type RawEntry,
  type ToolUseBlock,
} from './jsonlParser';
import { IncrementalReader } from './incrementalReader';
import { registry } from './registry';
import { ownerMatchesAgent, reconcileTeamPlaceholders } from './teamMatcher';
import { costForUsage } from '../pricing';
import { localHostId, localHostLabel } from './watcherCore';
import { AGENT_ACTIVE_THRESHOLD_MS } from '@/lib/config/runtime';
import type { Task, Agent, AgentStatus } from '@/types';

/** Metadata captured when an Agent tool_use is first seen, before the result arrives */
interface PendingSpawn {
  toolUseId: string;
  name: string;
  subagentType?: string;
  description?: string;
  promptPreview?: string;
  timestamp: string;
}

/** A TaskCreate whose numeric id hasn't been resolved yet (waiting for tool_result) */
interface PendingTask {
  toolUseId: string;
  subject: string;
  description?: string;
  activeForm?: string;
  timestamp: string;
}

export class MainSessionWatcher {
  private reader: IncrementalReader;
  private pendingSpawns = new Map<string, PendingSpawn>();
  private pendingTasks = new Map<string, PendingTask>();
  /** tool_use.id → tool_use block, for correlating results */
  private seenToolUses = new Map<string, ToolUseBlock>();

  constructor(
    private readonly jsonlPath: string,
    private readonly subagentsDir: string,
    private readonly onSubagentDiscovered: (agentId: string, transcriptPath: string) => void,
  ) {
    this.reader = new IncrementalReader(jsonlPath);
  }

  async coldStart(): Promise<void> {
    const text = await this.reader.coldStart();
    if (text) this.processText(text);
    this.refreshMainStatus();
  }

  async poll(): Promise<void> {
    const text = await this.reader.readNew();
    if (text) this.processText(text);
    this.refreshMainStatus();
  }

  /**
   * Demote the main agent from 'active' to 'idle' once its transcript has been
   * quiet for AGENT_ACTIVE_THRESHOLD_MS. Mirrors SubagentWatcher.refreshAgentStatus
   * but never marks main 'completed' — it's the long-lived user session.
   */
  private refreshMainStatus(): void {
    const main = registry.getAgent('main');
    if (!main || main.status !== 'active') return;

    let mtimeMs = 0;
    try {
      mtimeMs = statSync(this.jsonlPath).mtimeMs;
    } catch {
      return;
    }
    const ageMs = Date.now() - mtimeMs;
    if (ageMs > AGENT_ACTIVE_THRESHOLD_MS) {
      registry.upsertAgent({ ...main, status: 'idle' });
    }
  }

  private processText(text: string): void {
    const { entries } = parseJsonlLines(text);
    for (const entry of entries) {
      this.processEntry(entry);
    }
  }

  private processEntry(entry: RawEntry): void {
    // CRITICAL: skip sidechain lines — they duplicate subagent traffic
    if (entry.isSidechain === true) return;

    const ts = entry.timestamp ?? new Date().toISOString();
    const role = entry.message?.role;

    if (role === 'assistant') {
      this.processAssistantEntry(entry, ts);
    } else if (role === 'user') {
      this.processUserEntry(entry, ts);
    }
  }

  private processAssistantEntry(entry: RawEntry, ts: string): void {
    const toolUses = extractToolUses(entry);
    const model = entry.message?.model;
    const usage = entry.message?.usage;

    // Ensure the main agent exists
    const existingMain = registry.getAgent('main');
    if (!existingMain) {
      const mainAgent: Agent = {
        id: 'main',
        type: 'main',
        name: 'main',
        model,
        status: 'active',
        phase: 'exploring',
        startedAt: ts,
        lastActiveAt: ts,
        toolUseCount: 0,
        transcriptPath: this.jsonlPath,
        recentToolUseTimestamps: [],
        tokensIn: 0,
        tokensOut: 0,
        cacheCreateTokens: 0,
        cacheReadTokens: 0,
        estCostUsd: 0,
        hostId: localHostId(),
        hostLabel: localHostLabel(),
      };
      registry.upsertAgent(mainAgent);
    } else if (model && !existingMain.model) {
      registry.upsertAgent({ ...existingMain, model, lastActiveAt: ts });
    }

    // Accumulate tokens/cost on main for this assistant turn
    if (usage) {
      const main = registry.getAgent('main');
      if (main) {
        const effectiveModel = main.model ?? model;
        registry.upsertAgent({
          ...main,
          tokensIn: main.tokensIn + (usage.input_tokens ?? 0),
          tokensOut: main.tokensOut + (usage.output_tokens ?? 0),
          cacheCreateTokens:
            main.cacheCreateTokens + (usage.cache_creation_input_tokens ?? 0),
          cacheReadTokens:
            main.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
          estCostUsd: main.estCostUsd + costForUsage(effectiveModel, usage),
        });
      }
    }

    for (const block of toolUses) {
      // Only track tool-use blocks that are later looked up (Agent spawns and
      // TaskCreates). All other tool-use types are never correlated with a
      // tool_result, so inserting them would grow the Map unboundedly.
      if (block.name === 'Agent' || block.name === 'TaskCreate') {
        this.seenToolUses.set(block.id, block);
      }
      this.handleToolUse(block, ts);
    }
  }

  private handleToolUse(block: ToolUseBlock, ts: string): void {
    const input = block.input as Record<string, unknown>;

    // Update main agent activity
    const main = registry.getAgent('main');
    if (main) {
      const newTimestamps = [
        ...main.recentToolUseTimestamps.filter(
          (t) => Date.now() - new Date(t).getTime() < 60_000,
        ),
        ts,
      ];
      registry.upsertAgent({
        ...main,
        status: 'active',
        toolUseCount: main.toolUseCount + 1,
        lastActiveAt: ts,
        lastAction: `${block.name}${input.file_path ? ` ${String(input.file_path)}` : input.taskId ? ` #${String(input.taskId)}` : ''}`,
        recentToolUseTimestamps: newTimestamps,
      });
    }

    switch (block.name) {
      case 'TaskCreate': {
        const pt: PendingTask = {
          toolUseId: block.id,
          subject: String(input.subject ?? ''),
          description: input.description ? String(input.description) : undefined,
          activeForm: input.activeForm ? String(input.activeForm) : undefined,
          timestamp: ts,
        };
        this.pendingTasks.set(block.id, pt);
        break;
      }

      case 'TaskUpdate': {
        const taskId = String(input.taskId ?? '');
        const existing = registry.getTask(taskId);
        if (existing) {
          const prevOwner = existing.owner;
          const updated: Task = {
            ...existing,
            status: (input.status as Task['status']) ?? existing.status,
            owner: input.owner ? String(input.owner) : existing.owner,
            blockedBy: input.addBlockedBy
              ? [
                  ...existing.blockedBy,
                  ...(input.addBlockedBy as string[]),
                ]
              : existing.blockedBy,
            updatedAt: ts,
            completedAt:
              input.status === 'completed' ? ts : existing.completedAt,
          };
          registry.upsertTask(updated);
          registry.addEvent({
            id: randomUUID(),
            agentId: 'main',
            agentName: 'main',
            type: 'task_update',
            summary: `Task #${taskId} → ${String(input.status ?? 'updated')}`,
            details: { taskId, input },
            timestamp: ts,
            hostId: localHostId(),
            hostLabel: localHostLabel(),
          });

          if (updated.owner) {
            this.ensureTeamAgentForOwner(updated.owner, ts);
            this.recomputeTeamAgentStatus(updated.owner, ts);
          }
          if (prevOwner && prevOwner !== updated.owner) {
            this.recomputeTeamAgentStatus(prevOwner, ts);
          }
        }
        break;
      }

      case 'Agent': {
        const spawn: PendingSpawn = {
          toolUseId: block.id,
          name: String(input.name ?? 'agent'),
          subagentType: input.subagent_type ? String(input.subagent_type) : undefined,
          description: input.description ? String(input.description) : undefined,
          promptPreview: input.prompt
            ? String(input.prompt).slice(0, 500)
            : undefined,
          timestamp: ts,
        };
        this.pendingSpawns.set(block.id, spawn);
        break;
      }

      default: {
        // Generic tool use event on main agent
        registry.addEvent({
          id: randomUUID(),
          agentId: 'main',
          agentName: 'main',
          type: 'tool_use',
          toolName: block.name,
          summary: `${block.name}${input.file_path ? ` ${String(input.file_path)}` : ''}`,
          details: { input },
          timestamp: ts,
          hostId: localHostId(),
          hostLabel: localHostLabel(),
        });
      }
    }
  }

  /**
   * Upsert a synthetic 'team' agent for a task owner string that doesn't
   * correspond to a real agent (main or spawned subagent). Team agents have
   * no transcript — they surface ownership in the top strip.
   */
  private ensureTeamAgentForOwner(owner: string, ts: string): void {
    if (!owner) return;
    const matchesReal = registry
      .getAgents()
      .some((a) => a.type !== 'team' && ownerMatchesAgent(owner, a));
    if (matchesReal) return;

    const teamId = `team:${owner}`;
    const existing = registry.getAgent(teamId);
    if (existing) {
      registry.upsertAgent({ ...existing, lastActiveAt: ts });
      return;
    }
    const agent: Agent = {
      id: teamId,
      type: 'team',
      name: owner,
      status: 'idle',
      phase: 'exploring',
      startedAt: ts,
      lastActiveAt: ts,
      toolUseCount: 0,
      transcriptPath: '',
      recentToolUseTimestamps: [],
      tokensIn: 0,
      tokensOut: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      estCostUsd: 0,
      hostId: localHostId(),
      hostLabel: localHostLabel(),
    };
    registry.upsertAgent(agent);
  }

  /**
   * Recompute a team agent's status from the current state of its owned tasks.
   * active  → any task in_progress
   * idle    → any task pending (no in_progress)
   * completed → all tasks completed/failed
   */
  private recomputeTeamAgentStatus(owner: string, ts: string): void {
    const teamId = `team:${owner}`;
    const existing = registry.getAgent(teamId);
    if (!existing || existing.type !== 'team') return;
    const ownedTasks = registry.getTasks().filter((t) => t.owner === owner);
    if (ownedTasks.length === 0) return;
    const hasInProgress = ownedTasks.some((t) => t.status === 'in_progress');
    const hasPending = ownedTasks.some((t) => t.status === 'pending');
    const status: AgentStatus = hasInProgress
      ? 'active'
      : hasPending
        ? 'idle'
        : 'completed';
    if (status === existing.status) return;
    registry.upsertAgent({ ...existing, status, lastActiveAt: ts });
  }

  private processUserEntry(entry: RawEntry, ts: string): void {
    const toolResults = extractToolResults(entry);
    const toolUseResult = entry.toolUseResult;

    for (const result of toolResults) {
      const toolUseId = result.tool_use_id;
      const originalToolUse = this.seenToolUses.get(toolUseId);
      if (!originalToolUse) continue;

      // Resolve a pending Agent spawn
      const pendingSpawn = this.pendingSpawns.get(toolUseId);
      if (pendingSpawn && toolUseResult?.agentId) {
        const agentId = toolUseResult.agentId;
        const transcriptPath = `${this.subagentsDir}/agent-${agentId}.jsonl`;
        const agent: Agent = {
          id: agentId,
          type: 'subagent',
          name: pendingSpawn.name,
          subagentType: pendingSpawn.subagentType,
          description: pendingSpawn.description,
          status: 'active',
          phase: 'spawning',
          startedAt: ts,
          lastActiveAt: ts,
          toolUseCount: 0,
          transcriptPath,
          spawnPromptPreview: pendingSpawn.promptPreview,
          recentToolUseTimestamps: [],
          parentAgentId: 'main',
          parentAgentLabel: 'main',
          tokensIn: 0,
          tokensOut: 0,
          cacheCreateTokens: 0,
          cacheReadTokens: 0,
          estCostUsd: 0,
          hostId: localHostId(),
          hostLabel: localHostLabel(),
        };
        registry.upsertAgent(agent);
        reconcileTeamPlaceholders();
        registry.addEvent({
          id: randomUUID(),
          agentId,
          agentName: pendingSpawn.name,
          type: 'agent_spawn',
          summary: `Spawned ${pendingSpawn.subagentType ?? pendingSpawn.name}: ${pendingSpawn.description ?? ''}`,
          details: { agentId, transcriptPath },
          timestamp: ts,
          hostId: localHostId(),
          hostLabel: localHostLabel(),
        });
        this.pendingSpawns.delete(toolUseId);
        this.seenToolUses.delete(toolUseId);
        this.onSubagentDiscovered(agentId, transcriptPath);
        continue;
      }

      // Resolve a pending TaskCreate
      const pendingTask = this.pendingTasks.get(toolUseId);
      if (pendingTask && originalToolUse.name === 'TaskCreate') {
        // Parse the task id from the result text
        const resultText = this.extractResultText(result.content);
        const match = resultText.match(/Task #(\d+)/i);
        const taskId = match ? match[1] : `tmp-${toolUseId.slice(-6)}`;

        const task: Task = {
          id: taskId,
          subject: pendingTask.subject,
          description: pendingTask.description,
          activeForm: pendingTask.activeForm,
          status: 'pending',
          blockedBy: [],
          blocks: [],
          createdAt: pendingTask.timestamp,
          updatedAt: pendingTask.timestamp,
          createdByToolUseId: toolUseId,
        };
        registry.upsertTask(task);
        registry.addEvent({
          id: randomUUID(),
          agentId: 'main',
          agentName: 'main',
          type: 'task_create',
          summary: `Task #${taskId} created: ${pendingTask.subject}`,
          details: { taskId, subject: pendingTask.subject },
          timestamp: pendingTask.timestamp,
          hostId: localHostId(),
          hostLabel: localHostLabel(),
        });
        this.pendingTasks.delete(toolUseId);
        this.seenToolUses.delete(toolUseId);
      }
    }
  }

  private extractResultText(
    content: Array<{ type: string; text?: string }> | string,
  ): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    const textBlock = content.find((c) => c.type === 'text');
    return textBlock?.text ?? '';
  }
}
