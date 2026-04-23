'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useMissionStore } from '@/lib/store/missionStore';
import type { SSEMessage } from '@/types';

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

export function useSSE(baseUrl: string): void {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  // Hold latest connect fn in a ref to avoid stale closures in setTimeout
  const connectRef = useRef<() => void>(() => undefined);

  const {
    hydrateFromSnapshot,
    upsertAgent,
    removeAgent,
    upsertTask,
    addEvent,
    setStats,
    setSseStatus,
    touchLastReceived,
  } = useMissionStore();

  const handleMessage = useCallback(
    (message: SSEMessage) => {
      // Call touchLastReceived on every message (including ping) to drive HeartbeatIndicator
      touchLastReceived();

      switch (message.type) {
        case 'snapshot':
          hydrateFromSnapshot(message.payload);
          break;
        case 'agent:update':
          upsertAgent(message.payload);
          break;
        case 'agent:delete':
          removeAgent(message.payload.id);
          break;
        case 'task:replace':
          upsertTask(message.payload);
          break;
        case 'event:new':
          addEvent(message.payload);
          break;
        case 'stats:update':
          setStats(message.payload);
          break;
        case 'ping':
          // keep-alive — no state update beyond touchLastReceived above
          break;
      }
    },
    [hydrateFromSnapshot, upsertAgent, removeAgent, upsertTask, addEvent, setStats, touchLastReceived],
  );

  const connect = useCallback(() => {
    if (!isMountedRef.current) return;

    setSseStatus(reconnectAttemptRef.current === 0 ? 'connecting' : 'reconnecting');

    // On reconnects (attempt > 0), append ?since=N so the server replays missed events.
    // First connect always gets the full snapshot — no since param.
    const lastSeq = useMissionStore.getState().lastSeq;
    const url =
      reconnectAttemptRef.current > 0 && lastSeq > 0
        ? `${baseUrl}?since=${lastSeq}`
        : baseUrl;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      if (!isMountedRef.current) {
        es.close();
        return;
      }
      reconnectAttemptRef.current = 0;
      setSseStatus('connected');
    };

    es.onmessage = (e: MessageEvent) => {
      if (!isMountedRef.current) return;
      try {
        const message = JSON.parse(e.data as string) as SSEMessage;
        handleMessage(message);
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      if (!isMountedRef.current) return;

      setSseStatus('disconnected');

      // Exponential backoff with ±20% jitter
      const jitter = 0.8 + Math.random() * 0.4;
      const delay = Math.min(
        BASE_RECONNECT_DELAY * 2 ** reconnectAttemptRef.current * jitter,
        MAX_RECONNECT_DELAY,
      );
      reconnectAttemptRef.current += 1;

      reconnectTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) connectRef.current();
      }, delay);
    };
  }, [baseUrl, handleMessage, setSseStatus]);

  // Keep ref in sync with latest connect to break stale-closure in setTimeout
  connectRef.current = connect;

  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);
}
