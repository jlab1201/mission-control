import { readdirSync, existsSync, statSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { IncrementalReader } from './incrementalReader';
import {
  parseJsonlLines,
  extractToolUses,
  extractToolResults,
  type RawEntry,
  type ToolUseBlock,
} from './jsonlParser';
import { detectPhase } from './phaseDetector';
import { registry } from './registry';
import { reconcileTeamPlaceholders } from './teamMatcher';
import { costForUsage } from '../pricing';
import { localHostId, localHostLabel } from './watcherCore';
import type { Agent } from '@/types';
import {
  AGENT_ACTIVE_THRESHOLD_MS,
  AGENT_COMPLETED_THRESHOLD_MS,
  MAX_RECENT_TOOLS,
  RECENT_TOOLUSE_WINDOW_MS,
  PROMPT_PREVIEW_CHARS,
} from '@/lib/config/runtime';

interface PendingSubSpawn {
  toolUseId: string;
  name: string;
  subagentType?: string;
  description?: string;
  promptPreview?: string;
  parentAgentId: string;
  parentLabel: string;
  timestamp: string;
}

interface TrackedAgent {
  agentId: string;
  transcriptPath: string;
  reader: IncrementalReader;
  /** Recent tool names (newest last), kept at max 20 */
  recentToolNames: string[];
  /** Agent spawns by this subagent awaiting their tool_result */
  pendingSpawns: Map<string, PendingSubSpawn>;
  /** tool_use id → block, for correlating with tool_results */
  seenToolUses: Map<string, ToolUseBlock>;
  /**
   * Set of tool_use ids whose matching tool_result has not yet been written
   * to the transcript. While non-empty, the agent is "blocked on a tool" and
   * its mtime stillness is expected — refreshAgentStatus must keep it 'active'
   * so a long Bash/playwright run does not get falsely marked idle/completed.
   */
  pendingTools: Set<string>;
}

export class SubagentWatcher {
  private tracked = new Map<string, TrackedAgent>();

  constructor(private readonly subagentsDir: string) {}

  /** Register a known subagent (called by mainSessionWatcher on spawn). */
  add(agentId: string, transcriptPath: string): void {
    if (this.tracked.has(agentId)) return;
    this.tracked.set(agentId, {
      agentId,
      transcriptPath,
      reader: new IncrementalReader(transcriptPath),
      recentToolNames: [],
      pendingSpawns: new Map(),
      seenToolUses: new Map(),
      pendingTools: new Set(),
    });
  }

  /** Run cold-start on all currently tracked agents. */
  async coldStart(): Promise<void> {
    // First, discover any existing subagent files in the directory
    this.scanDirectory();

    const tasks = Array.from(this.tracked.values()).map((t) =>
      this.coldStartAgent(t),
    );
    await Promise.all(tasks);
  }

  private async coldStartAgent(tracked: TrackedAgent): Promise<void> {
    const text = await tracked.reader.coldStart();
    if (text) {
      this.processAgentText(tracked, text);
    }
    this.refreshAgentStatus(tracked);
  }

  /** Called every 750ms by the poll loop. */
  async poll(): Promise<void> {
    // Discover new subagent files
    this.scanDirectory();

    const tasks = Array.from(this.tracked.values()).map((t) =>
      this.pollAgent(t),
    );
    await Promise.all(tasks);
  }

  private async pollAgent(tracked: TrackedAgent): Promise<void> {
    const text = await tracked.reader.readNew();
    if (text) {
      this.processAgentText(tracked, text);
    }
    this.refreshAgentStatus(tracked);
  }

  private scanDirectory(): void {
    if (!existsSync(this.subagentsDir)) return;

    let files: string[];
    try {
      files = readdirSync(this.subagentsDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.startsWith('agent-') || !file.endsWith('.jsonl')) continue;
      // e.g. "agent-a7e4f6ebb504de9f6.jsonl" → "a7e4f6ebb504de9f6"
      const agentId = basename(file, '.jsonl').replace(/^agent-/, '');
      if (!this.tracked.has(agentId)) {
        const transcriptPath = join(this.subagentsDir, file);
        this.add(agentId, transcriptPath);

        // Create a placeholder in the registry if not already present
        if (!registry.getAgent(agentId)) {
          const now = new Date().toISOString();
          // Claude Code writes an `agent-<id>.meta.json` sidecar next to each
          // subagent transcript (e.g. {"agentType":"backend-dev","description":…}).
          // Read it so a subagent discovered on disk — rather than via a
          // correlated Agent spawn in the main transcript — still carries its
          // team role; otherwise it's an anonymous orphan the sidebar can't
          // match to its rail card.
          const meta = readAgentMeta(this.subagentsDir, agentId);
          const placeholder: Agent = {
            id: agentId,
            type: 'subagent',
            name: agentId.slice(0, 8),
            subagentType: meta?.agentType,
            description: meta?.description,
            status: 'idle',
            phase: 'spawning',
            startedAt: now,
            lastActiveAt: now,
            toolUseCount: 0,
            transcriptPath,
            recentToolUseTimestamps: [],
            tokensIn: 0,
            tokensOut: 0,
            cacheCreateTokens: 0,
            cacheReadTokens: 0,
            estCostUsd: 0,
            hostId: localHostId(),
            hostLabel: localHostLabel(),
            workDurationMs: 0,
            activeStreakStart: null,
          };
          registry.upsertAgent(placeholder);
          reconcileTeamPlaceholders();
        }
      }
    }
  }

  private processAgentText(tracked: TrackedAgent, text: string): void {
    const { entries } = parseJsonlLines(text);
    for (const entry of entries) {
      // NOTE: do NOT filter on entry.isSidechain here. In a subagent's OWN
      // transcript file, every entry is marked sidechain=true — those ARE
      // the subagent's actual messages, not duplicates. The sidechain filter
      // is only correct in mainSessionWatcher, where sidechain entries in
      // the main JSONL really are mirrored subagent traffic that we already
      // see via this watcher.
      const role = entry.message?.role;
      if (role === 'assistant') {
        this.processAssistantEntry(tracked, entry);
      } else if (role === 'user') {
        this.processUserEntry(tracked, entry);
      }
    }
  }

  private processAssistantEntry(tracked: TrackedAgent, entry: RawEntry): void {
    const toolUses = extractToolUses(entry);
    const ts = entry.timestamp ?? new Date().toISOString();
    const usage = entry.message?.usage;
    const entryModel = entry.message?.model;

    // Capture model on first assistant entry, accumulate tokens/cost every time
    if (entryModel || usage) {
      const agent = registry.getAgent(tracked.agentId);
      if (agent) {
        const effectiveModel = agent.model ?? entryModel;
        const next: Agent = {
          ...agent,
          model: agent.model ?? entryModel,
          tokensIn: agent.tokensIn + (usage?.input_tokens ?? 0),
          tokensOut: agent.tokensOut + (usage?.output_tokens ?? 0),
          cacheCreateTokens:
            agent.cacheCreateTokens + (usage?.cache_creation_input_tokens ?? 0),
          cacheReadTokens:
            agent.cacheReadTokens + (usage?.cache_read_input_tokens ?? 0),
          estCostUsd:
            agent.estCostUsd + costForUsage(effectiveModel, usage ?? {}),
        };
        registry.upsertAgent(next);
      }
    }

    for (const block of toolUses) {
      tracked.seenToolUses.set(block.id, block);
      tracked.pendingTools.add(block.id);

      const input = block.input as Record<string, unknown>;
      tracked.recentToolNames.push(block.name);
      if (tracked.recentToolNames.length > MAX_RECENT_TOOLS) {
        tracked.recentToolNames.shift();
      }

      const agent = registry.getAgent(tracked.agentId);
      if (!agent) continue;

      const newTimestamps = [
        ...agent.recentToolUseTimestamps.filter(
          (t) => Date.now() - new Date(t).getTime() < RECENT_TOOLUSE_WINDOW_MS,
        ),
        ts,
      ];

      const updated: Agent = {
        ...agent,
        status: 'active',
        phase: detectPhase(tracked.recentToolNames, false),
        lastActiveAt: ts,
        toolUseCount: agent.toolUseCount + 1,
        lastAction: `${block.name}${input.file_path ? ` ${String(input.file_path)}` : ''}`,
        recentToolUseTimestamps: newTimestamps,
      };
      registry.upsertAgent(updated);

      registry.addEvent({
        id: randomUUID(),
        agentId: tracked.agentId,
        agentName: agent.name,
        type: 'tool_use',
        toolName: block.name,
        summary: `${block.name}${input.file_path ? ` ${String(input.file_path)}` : ''}`,
        details: { input },
        timestamp: ts,
        hostId: localHostId(),
        hostLabel: localHostLabel(),
      });

      // If this subagent spawns another agent, record a pending sub-sub so we can
      // set parent metadata when the tool_result arrives.
      if (block.name === 'Agent') {
        const parentLabel = agent.subagentType ?? agent.name ?? tracked.agentId.slice(0, 8);
        tracked.pendingSpawns.set(block.id, {
          toolUseId: block.id,
          name: String(input.name ?? 'agent'),
          subagentType: input.subagent_type ? String(input.subagent_type) : undefined,
          description: input.description ? String(input.description) : undefined,
          promptPreview: input.prompt ? String(input.prompt).slice(0, PROMPT_PREVIEW_CHARS) : undefined,
          parentAgentId: tracked.agentId,
          parentLabel,
          timestamp: ts,
        });
      }
    }
  }

  private processUserEntry(tracked: TrackedAgent, entry: RawEntry): void {
    const toolResults = extractToolResults(entry);
    const toolUseResult = entry.toolUseResult;
    const ts = entry.timestamp ?? new Date().toISOString();

    // Drain pendingTools for every result, regardless of whether it matches
    // a known spawn. Every tool_use eventually has a matching tool_result —
    // unmatched ids would otherwise leak the agent into permanent 'active'.
    for (const result of toolResults) {
      tracked.pendingTools.delete(result.tool_use_id);
    }

    for (const result of toolResults) {
      const pending = tracked.pendingSpawns.get(result.tool_use_id);
      if (!pending || !toolUseResult?.agentId) continue;

      const childId = toolUseResult.agentId;
      const childTranscriptPath = join(this.subagentsDir, `agent-${childId}.jsonl`);

      const childAgent: Agent = {
        id: childId,
        type: 'subagent',
        name: pending.name,
        subagentType: pending.subagentType,
        description: pending.description,
        status: 'active',
        phase: 'spawning',
        startedAt: ts,
        lastActiveAt: ts,
        toolUseCount: 0,
        transcriptPath: childTranscriptPath,
        spawnPromptPreview: pending.promptPreview,
        recentToolUseTimestamps: [],
        parentAgentId: pending.parentAgentId,
        parentAgentLabel: pending.parentLabel,
        tokensIn: 0,
        tokensOut: 0,
        cacheCreateTokens: 0,
        cacheReadTokens: 0,
        estCostUsd: 0,
        hostId: localHostId(),
        hostLabel: localHostLabel(),
        workDurationMs: 0,
        activeStreakStart: null,
      };
      registry.upsertAgent(childAgent);

      registry.addEvent({
        id: randomUUID(),
        agentId: childId,
        agentName: pending.name,
        type: 'agent_spawn',
        summary: `${pending.parentLabel} spawned ${pending.subagentType ?? pending.name}${pending.description ? `: ${pending.description}` : ''}`,
        details: { agentId: childId, parentAgentId: pending.parentAgentId },
        timestamp: ts,
        hostId: localHostId(),
        hostLabel: localHostLabel(),
      });

      // Make sure the new child is tracked so its transcript is polled
      this.add(childId, childTranscriptPath);

      tracked.pendingSpawns.delete(result.tool_use_id);
    }
  }

  private refreshAgentStatus(tracked: TrackedAgent): void {
    const agent = registry.getAgent(tracked.agentId);
    if (!agent) return;

    // If at least one tool_use is still awaiting its tool_result, the agent
    // is alive and blocked on the tool — keep it 'active' regardless of
    // mtime. This is what allows long-running Bash/playwright/test calls to
    // hold the spinner instead of the agent appearing dead at 30s.
    if (tracked.pendingTools.size > 0) {
      if (agent.status !== 'active') {
        registry.upsertAgent({ ...agent, status: 'active' });
      }
      return;
    }

    let mtimeMs = 0;
    try {
      mtimeMs = statSync(tracked.transcriptPath).mtimeMs;
    } catch {
      return;
    }

    const ageMs = Date.now() - mtimeMs;

    if (ageMs > AGENT_COMPLETED_THRESHOLD_MS && agent.status !== 'completed') {
      const updated: Agent = {
        ...agent,
        status: 'completed',
        phase: detectPhase(tracked.recentToolNames, true),
      };
      registry.upsertAgent(updated);
      registry.addEvent({
        id: randomUUID(),
        agentId: tracked.agentId,
        agentName: agent.name,
        type: 'agent_complete',
        summary: `${agent.name} completed`,
        timestamp: new Date().toISOString(),
        hostId: localHostId(),
        hostLabel: localHostLabel(),
      });
    } else if (ageMs > AGENT_ACTIVE_THRESHOLD_MS && agent.status === 'active') {
      registry.upsertAgent({ ...agent, status: 'idle' });
    }
  }
}

interface AgentMeta {
  agentType?: string;
  description?: string;
}

/**
 * Reads the `agent-<id>.meta.json` sidecar Claude Code writes next to a
 * subagent transcript. Returns null if absent or malformed; tolerates either
 * field being missing or non-string.
 */
function readAgentMeta(subagentsDir: string, agentId: string): AgentMeta | null {
  const metaPath = join(subagentsDir, `agent-${agentId}.meta.json`);
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
      agentType?: unknown;
      description?: unknown;
    };
    return {
      agentType: typeof parsed.agentType === 'string' ? parsed.agentType : undefined,
      description:
        typeof parsed.description === 'string' ? parsed.description : undefined,
    };
  } catch {
    return null;
  }
}
