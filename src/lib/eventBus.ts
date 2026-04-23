import { EventEmitter } from 'events';
import type { SSEMessage } from '@/types';

const g = globalThis as unknown as { __missionBus?: EventEmitter };
if (!g.__missionBus) {
  g.__missionBus = new EventEmitter();
  g.__missionBus.setMaxListeners(0); // unlimited: each SSE client adds one listener; count is bounded by P2.1's connection cap in stream/route.ts
}

export const eventBus = g.__missionBus;

export function broadcast(message: SSEMessage): void {
  eventBus.emit('message', message);
}
