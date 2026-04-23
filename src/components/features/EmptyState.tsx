'use client';

import { APP_NAME } from '@/lib/config/branding';

export function EmptyState() {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-8"
      role="status"
      aria-label="No active session"
    >
      {/* Hexagon logo */}
      <div className="relative mb-8">
        <svg
          width="72"
          height="72"
          viewBox="0 0 80 80"
          fill="none"
          aria-hidden="true"
          style={{ opacity: 0.6 }}
        >
          <polygon
            points="40,4 72,22 72,58 40,76 8,58 8,22"
            stroke="var(--accent-primary)"
            strokeWidth="1.5"
            fill="color-mix(in srgb, var(--accent-primary) 5%, transparent)"
          />
          <polygon
            points="40,16 62,28 62,52 40,64 18,52 18,28"
            stroke="var(--accent-primary)"
            strokeWidth="1"
            fill="color-mix(in srgb, var(--accent-primary) 2%, transparent)"
            strokeOpacity="0.4"
          />
          <circle
            cx="40"
            cy="40"
            r="6"
            fill="color-mix(in srgb, var(--accent-primary) 15%, transparent)"
            stroke="var(--accent-primary)"
            strokeWidth="1"
            strokeOpacity="0.4"
          />
        </svg>
        {/* Subtle glow */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, color-mix(in srgb, var(--accent-primary) 10%, transparent) 0%, transparent 70%)',
            transform: 'scale(2)',
          }}
        />
      </div>

      {/* Heading */}
      <h1
        className="font-mono font-bold tracking-widest text-center mb-3"
        style={{
          color: 'color-mix(in srgb, var(--accent-primary) 55%, transparent)',
          fontSize: '13px',
          letterSpacing: '0.3em',
        }}
      >
        {APP_NAME.toUpperCase()}
      </h1>

      {/* Subtitle */}
      <p
        className="text-sm font-medium text-center mb-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        No active session detected
      </p>

      {/* Body */}
      <p
        className="text-xs text-center max-w-sm leading-relaxed mb-8"
        style={{ color: 'var(--text-muted)' }}
      >
        Spawn an agent via Claude Code&apos;s Agent tool or use TaskCreate to see
        activity here.
      </p>

      {/* Example code snippet — lab-panel applied */}
      <div className="lab-panel px-5 py-4 max-w-sm w-full">
        <span
          className="font-mono text-[9px] uppercase tracking-widest block mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          example
        </span>
        <pre
          className="font-mono text-xs leading-relaxed overflow-x-auto"
          style={{ color: 'var(--text-secondary)', whiteSpace: 'pre' }}
        >
{`Agent({
  subagent_type: 'backend-dev',
  description: 'Build API routes',
  prompt: '...'
})`}
        </pre>
      </div>

      {/* Scanning animation dots */}
      <div className="flex items-center gap-2 mt-10">
        {[0, 0.3, 0.6].map((delay, i) => (
          <div
            key={i}
            className="w-1 h-1 rounded-full"
            style={{
              backgroundColor: 'var(--accent-primary)',
              opacity: 0.3,
              animation: `pulse-green 2s ${delay}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
