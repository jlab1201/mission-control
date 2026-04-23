import type { Agent } from '@/types';
import { registry } from './registry';

const ROLE_SUFFIXES = ['-dev', '-engineer', '-specialist', '-eng', '-qa', '-lead'];

function stripRoleSuffix(s: string): string {
  for (const suffix of ROLE_SUFFIXES) {
    if (s.endsWith(suffix)) return s.slice(0, -suffix.length);
  }
  return s;
}

/**
 * True if the task owner string refers to the same role as `agent`, tolerating
 * common suffix variations so that `owner="frontend"` still matches an agent
 * with `subagentType="frontend-dev"` (and vice versa).
 */
export function ownerMatchesAgent(owner: string, agent: Agent): boolean {
  if (!owner || agent.type === 'team') return false;
  const o = owner.toLowerCase();
  const candidates = [agent.id, agent.name, agent.subagentType]
    .filter((v): v is string => Boolean(v))
    .map((s) => s.toLowerCase());
  for (const c of candidates) {
    if (c === o) return true;
    if (c.startsWith(`${o}-`) || o.startsWith(`${c}-`)) return true;
    const oRoot = stripRoleSuffix(o);
    const cRoot = stripRoleSuffix(c);
    if (oRoot && oRoot === cRoot) return true;
  }
  return false;
}

/**
 * Remove synthetic `team:*` placeholders whose owner now resolves to a real
 * (main or subagent) agent on the **same host**. Called after new real agents
 * register so the "agents" stat reflects real workers rather than lingering
 * placeholders.
 */
export function reconcileTeamPlaceholders(): void {
  const all = registry.getAgents();
  const teams = all.filter((a) => a.type === 'team');
  for (const team of teams) {
    const owner = team.name;
    const realMatch = all.find(
      (a) =>
        a.type !== 'team' &&
        a.hostId === team.hostId &&
        ownerMatchesAgent(owner, a),
    );
    if (realMatch) registry.removeAgent(team.id);
  }
}
