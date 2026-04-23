'use client';

import type { AgentPhase } from '@/types';

const PHASES: AgentPhase[] = ['spawning', 'exploring', 'implementing', 'reporting', 'done'];

const PHASE_LABELS: Record<AgentPhase, string> = {
  spawning: 'SPAWN',
  exploring: 'EXPLORE',
  implementing: 'IMPL',
  reporting: 'REPORT',
  done: 'DONE',
};

interface PhaseIndicatorProps {
  phase: AgentPhase;
  color?: string;
}

export function PhaseIndicator({ phase, color = 'var(--accent-primary)' }: PhaseIndicatorProps) {
  const currentIndex = PHASES.indexOf(phase);

  return (
    <div className="flex items-center gap-0.5" role="status" aria-label={`Phase: ${phase}`}>
      {PHASES.map((p, i) => {
        const isCurrent = i === currentIndex;
        const isPast = i < currentIndex;

        return (
          <div key={p} className="flex items-center gap-0.5">
            <span
              className="text-[9px] font-mono tracking-wider px-1 py-0.5 rounded-sm transition-all duration-300"
              style={
                isCurrent
                  ? {
                      backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`,
                      color: color,
                      border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
                      textShadow: `0 0 8px color-mix(in srgb, ${color} 53%, transparent)`,
                    }
                  : isPast
                  ? {
                      backgroundColor: `color-mix(in srgb, ${color} 7%, transparent)`,
                      color: `color-mix(in srgb, ${color} 33%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${color} 13%, transparent)`,
                    }
                  : {
                      backgroundColor: 'transparent',
                      color: 'var(--surface-elevated)',
                      border: '1px solid var(--border)',
                    }
              }
            >
              {PHASE_LABELS[p]}
            </span>
            {i < PHASES.length - 1 && (
              <span
                className="text-[8px]"
                style={{
                  color: i < currentIndex
                    ? `color-mix(in srgb, ${color} 27%, transparent)`
                    : 'var(--border)',
                }}
              >
                ›
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
