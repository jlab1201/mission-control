import type { AgentPhase } from '@/types';

const EXPLORE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'Cat']);
const IMPLEMENT_TOOLS = new Set(['Edit', 'Write', 'Bash', 'MultiEdit']);

/**
 * Infers the current phase of an agent from its recent tool-use history.
 * @param recentToolNames - Tool names used most recently (newest last)
 * @param isCompleted - Whether the agent is marked as done
 */
export function detectPhase(
  recentToolNames: string[],
  isCompleted: boolean,
): AgentPhase {
  if (isCompleted) return 'done';
  if (recentToolNames.length === 0) return 'spawning';

  // Look at last 5 tool uses
  const window = recentToolNames.slice(-5);

  let exploreCount = 0;
  let implementCount = 0;

  for (const name of window) {
    if (EXPLORE_TOOLS.has(name)) exploreCount++;
    else if (IMPLEMENT_TOOLS.has(name)) implementCount++;
  }

  if (implementCount >= exploreCount && implementCount > 0) return 'implementing';
  if (exploreCount > 0) return 'exploring';
  return 'spawning';
}
