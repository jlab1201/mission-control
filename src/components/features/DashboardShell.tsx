'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useMissionStore } from '@/lib/store/missionStore';
import { MissionBar } from '@/components/features/MissionBar';
import { MissionFooter } from '@/components/features/MissionFooter';
import { AgentPanel } from '@/components/features/AgentPanel';
import { TaskKanban } from '@/components/features/TaskKanban';
import { TaskDetailDrawer } from '@/components/features/TaskDetailDrawer';
import { EmptyState } from '@/components/features/EmptyState';
import type { AgentDefinition } from '@/types';

const PANEL_WIDTH_KEY = 'mc.panel.width';
const PANEL_WIDTH_MIN = 200;
const PANEL_WIDTH_MAX = 480;
const PANEL_WIDTH_DEFAULT = 260;

export function DashboardShell() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(PANEL_WIDTH_DEFAULT);
  const draggingRef = useRef(false);

  const mission = useMissionStore((s) => s.mission);
  const agentsMap = useMissionStore((s) => s.agents);
  const tasksMap = useMissionStore((s) => s.tasks);
  const events = useMissionStore((s) => s.events);
  const sseStatus = useMissionStore((s) => s.sseStatus);
  const agentDefinitions = useMissionStore((s) => s.agentDefinitions);
  const setAgentDefinitions = useMissionStore((s) => s.setAgentDefinitions);

  const agents = Object.values(agentsMap);
  const tasks = Object.values(tasksMap);
  const isEmpty = agents.length === 0 && tasks.length === 0;

  // Load persisted panel width on mount
  useEffect(() => {
    const raw = localStorage.getItem(PANEL_WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (!isNaN(n) && n >= PANEL_WIDTH_MIN && n <= PANEL_WIDTH_MAX) {
      setPanelWidth(n);
    }
  }, []);

  // Fetch agent definitions on mount + whenever workspace changes
  useEffect(() => {
    let cancelled = false;
    fetch('/api/agent-definitions')
      .then((r) => r.json() as Promise<{ data: AgentDefinition[] }>)
      .then((body) => {
        if (!cancelled) setAgentDefinitions(body.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setAgentDefinitions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mission?.cwd, setAgentDefinitions]);

  const onDragStart = useCallback(() => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(
        PANEL_WIDTH_MAX,
        Math.max(PANEL_WIDTH_MIN, e.clientX),
      );
      setPanelWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setPanelWidth((w) => {
        localStorage.setItem(PANEL_WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <MissionBar mission={mission} tasks={tasks} />

      {isEmpty && sseStatus !== 'connecting' ? (
        <EmptyState />
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div
            style={{ width: `${panelWidth}px`, flexShrink: 0 }}
            className="h-full"
          >
            <AgentPanel agents={agents} definitions={agentDefinitions} />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize agent panel"
            onMouseDown={onDragStart}
            className="flex-shrink-0 relative group cursor-col-resize"
            style={{
              width: '4px',
              backgroundColor: 'var(--border)',
            }}
          >
            <div
              className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-colors duration-150"
              style={{
                width: '2px',
                backgroundColor: 'transparent',
              }}
            />
          </div>
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <TaskKanban
              tasks={tasks}
              agents={agents}
              onOpenTask={setSelectedTaskId}
            />
          </div>
        </div>
      )}

      <MissionFooter />

      <AnimatePresence>
        {selectedTaskId && (
          <TaskDetailDrawer
            key={selectedTaskId}
            taskId={selectedTaskId}
            tasks={tasks}
            agents={agents}
            events={events}
            onClose={() => setSelectedTaskId(null)}
            onNavigateToTask={setSelectedTaskId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
