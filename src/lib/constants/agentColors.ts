/**
 * Per-agent color palette.
 * Values are CSS variable references so they adapt to light/dark theme.
 * Fallback to --accent-primary when an agent id is not found.
 */
export const AGENT_COLORS: Record<string, string> = {
  // Core team-lead / main session
  main: 'var(--accent-primary)',
  'team-lead': 'var(--accent-primary)',

  // Specialist agents — distinct hues so task cards are visually distinguishable
  'frontend-dev': '#6366f1',      // indigo
  'backend-dev': '#0ea5e9',       // sky
  'devops-engineer': '#f59e0b',   // amber
  'qa-engineer': '#10b981',       // emerald
  'security-engineer': '#ef4444', // red
  'integration-specialist': '#8b5cf6', // violet
  'context-monitor': '#64748b',   // slate
};

/**
 * Returns the CSS color string for the given agent name/id.
 * Falls back to --accent-primary for unknown agents.
 */
export function agentColor(owner: string | undefined | null): string {
  if (!owner) return 'var(--accent-primary)';
  return AGENT_COLORS[owner] ?? 'var(--accent-primary)';
}
