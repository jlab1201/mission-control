import { registry } from '@/server/watcher/registry';
import { touchHost } from './hostRegistry';
import type { IngestPayload, AgentIngest, AgentEventIngest } from './schema';
import type { Agent, AgentEvent, Task } from '@/types';

export interface IngestResult {
  ingestedAgents: number;
  ingestedEvents: number;
  serverSeq: number;
}

export function applyIngest(
  hostId: string,
  hostLabel: string | undefined,
  watchedProjectPath: string | undefined,
  payload: IngestPayload,
): IngestResult {
  return registry.applyBatch(() => {
    touchHost(hostId, hostLabel, { watchedProjectPath });

    let ingestedAgents = 0;
    let ingestedEvents = 0;

    if (payload.mode === 'snapshot') {
      const incomingIds = new Set<string>(
        (payload.payload.agents ?? []).map((a: AgentIngest) => a.id),
      );
      registry.removeByHost(hostId, incomingIds);

      for (const a of payload.payload.agents ?? []) {
        const agent: Agent = {
          ...(a as Omit<Agent, 'hostId' | 'hostLabel'>),
          hostId,
          hostLabel: hostLabel ?? hostId,
        };
        registry.upsertAgent(agent);
        ingestedAgents++;
      }

      for (const t of payload.payload.tasks ?? []) {
        registry.upsertTask(t as Task);
      }

      for (const ev of payload.payload.events ?? []) {
        const clampedMs = Math.min(
          Date.parse((ev as AgentEventIngest).timestamp) || Date.now(),
          Date.now(),
        );
        const { seq: _seq, ...rest } = ev as AgentEventIngest & { seq?: unknown };
        const event: Omit<AgentEvent, 'seq'> = {
          ...(rest as Omit<AgentEvent, 'seq' | 'hostId' | 'hostLabel' | 'timestamp'>),
          hostId,
          hostLabel: hostLabel ?? hostId,
          timestamp: new Date(clampedMs).toISOString(),
        };
        registry.addEvent(event);
        ingestedEvents++;
      }
    } else {
      // delta mode
      for (const a of payload.payload.agents ?? []) {
        const agent: Agent = {
          ...(a as Omit<Agent, 'hostId' | 'hostLabel'>),
          hostId,
          hostLabel: hostLabel ?? hostId,
        };
        registry.upsertAgent(agent);
        ingestedAgents++;
      }

      for (const t of payload.payload.tasks ?? []) {
        registry.upsertTask(t as Task);
      }

      for (const ev of payload.payload.events ?? []) {
        const clampedMs = Math.min(
          Date.parse((ev as AgentEventIngest).timestamp) || Date.now(),
          Date.now(),
        );
        const { seq: _seq, ...rest } = ev as AgentEventIngest & { seq?: unknown };
        const event: Omit<AgentEvent, 'seq'> = {
          ...(rest as Omit<AgentEvent, 'seq' | 'hostId' | 'hostLabel' | 'timestamp'>),
          hostId,
          hostLabel: hostLabel ?? hostId,
          timestamp: new Date(clampedMs).toISOString(),
        };
        registry.addEvent(event);
        ingestedEvents++;
      }

      for (const id of payload.payload.removedAgentIds ?? []) {
        const existing = registry.getAgents().find((a) => a.id === id);
        if (existing && existing.hostId === hostId) {
          registry.removeAgent(id);
        }
      }
    }

    const serverSeq = registry.lastSeq;
    return { ingestedAgents, ingestedEvents, serverSeq };
  });
}
