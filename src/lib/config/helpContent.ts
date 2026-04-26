/**
 * Structured help content for the HelpModal.
 * Every explanation below was verified against the actual source code —
 * no values are invented or approximated.
 *
 * Sources verified:
 *   - src/server/pricing.ts       — per-model rates and costForUsage()
 *   - src/server/watcher/jsonlParser.ts — RawUsage field names
 *   - src/server/watcher/subagentWatcher.ts — token accumulation per agent
 *   - src/server/watcher/mainSessionWatcher.ts — main agent token accumulation
 *   - src/server/watcher/registry.ts — computeStats() for stats fields
 *   - src/components/features/MissionBar.tsx — top-bar aggregate formulas
 *   - src/types/index.ts           — Agent and MissionStats type definitions
 *   - src/server/ingest/hostRegistry.ts — host tracking and lastSeenAt
 *   - src/components/features/HostSelector.tsx — freshness dot thresholds
 */

export interface HelpEntry {
  label: string;
  whatItShows: string;
  source: string;
  formula?: string;
  caveats?: string;
}

export const HELP_ENTRIES: HelpEntry[] = [
  {
    label: 'Hosts',
    whatItShows:
      'The machines currently (or recently) reporting activity to this dashboard. Each host is a machine running Claude Code alongside the mc-reporter script, or the MC server itself (which always counts as the local host).',
    source:
      'Tracked in the server-side host registry (src/server/ingest/hostRegistry.ts). The local host is registered on boot. Remote hosts are registered on their first successful POST to /api/ingest and updated on every subsequent push.',
    formula:
      'Freshness dot color — green: lastSeenAt < 30 s ago; amber: < 2 min ago; red: 2 min or older.',
    caveats:
      'The host selector only appears in the top bar when more than one host is present; in single-host mode the UI is identical to before multi-host was introduced. All counts and stats on the dashboard reflect the currently selected host filter — "All hosts" shows the aggregate across every connected machine.',
  },
  {
    label: 'Model',
    whatItShows:
      'The AI model identifier used by the session. Shown as detected from the first assistant message in the main agent\'s JSONL transcript, or from the session snapshot.',
    source:
      'Read from mission.model (the session snapshot) or, if absent, from mainAgent.model — which is set the first time an assistant message with a non-empty "model" field appears in the main transcript file (~/.claude/projects/.../session.jsonl).',
    caveats:
      'If Claude Code does not embed the model name in the transcript, this field shows "unknown". Sub-agents may use different models; per-agent model names are tracked separately.',
  },
  {
    label: 'Uptime',
    whatItShows:
      'How long the Mission Control dashboard has been observing this project, displayed as HH:MM:SS. This is the dashboard\'s watch time, NOT the per-agent work time — each agent has its own timer on its card.',
    source:
      'Computed client-side in MissionBar.tsx using a 1-second interval: Math.floor((Date.now() - new Date(mission.startedAt).getTime()) / 1000). The startedAt timestamp comes from the mission snapshot and is set when the dashboard registry first initialises.',
    caveats:
      'This will not match the per-agent elapsed timers. Uptime starts when the dashboard started watching; an agent\'s timer starts when that agent first produced an event and freezes at its last tool use (so "5m30s" on an agent means 5m30s of real work, not 5m30s of wall clock). If Mission Control was started after Claude Code, agent timers will exceed Uptime.',
  },
  {
    label: 'Tasks',
    whatItShows:
      'Completed tasks out of total tasks, shown as "X/Y" (e.g. "3/7").',
    source:
      'Counted from the in-memory task registry. X = tasks where status === "completed"; Y = all tasks regardless of status. Tasks enter the registry when the main agent uses the TaskCreate tool and its result confirms a task ID.',
    formula:
      'completedTasks = tasks.filter(t => t.status === "completed").length; totalTasks = tasks.length',
    caveats:
      'Only tasks created via the TaskCreate tool are tracked. Tasks that Claude tracks in its own scratch notes, without calling TaskCreate, are invisible to the dashboard.',
  },
  {
    label: 'Agents',
    whatItShows:
      'The main Claude Code session plus any "team roles" named in TaskCreate that have not yet been bound to a real spawned agent. Real spawned workers are counted separately under "Subagents".',
    source:
      'agents.filter(a => a.type !== "subagent").length — computed in MissionBar.tsx. "main" is the top-level Claude Code session. "team" entries are synthetic placeholders created in src/server/watcher/mainSessionWatcher.ts:ensureTeamAgentForOwner when TaskCreate assigns an owner string (e.g. "frontend") that does not resolve to any existing agent.',
    caveats:
      'Matching is role-aware: owner "frontend" is recognised as the same role as an agent with subagentType "frontend-dev" (prefix and common-suffix matching, see src/server/watcher/teamMatcher.ts). Once a matching real subagent registers, the placeholder is removed via agent:delete so the count reflects live state. Team placeholders have no transcript and accumulate zero tokens or cost. When multiple hosts are connected, counts reflect the currently selected host filter.',
  },
  {
    label: 'Subagents',
    whatItShows:
      'The count of real subagents spawned via Claude Code\'s Agent tool. One per unique JSONL transcript.',
    source:
      'agents.filter(a => a.type === "subagent").length — computed in MissionBar.tsx. Subagents are registered when the main session watcher sees an Agent tool_use and its tool_result containing an agentId, or when a new agent-*.jsonl file appears in ~/.claude/projects/.../subagents/.',
    caveats:
      'Counted by unique agent ID (the JSONL filename). Re-running the "same" agent actually creates a new agent ID and therefore a new row — this is how Claude Code works, not a Mission Control double-count. Subagents stay in the count after they complete or go idle; the number is total-seen, not currently-active. When multiple hosts are connected, counts reflect the currently selected host filter.',
  },
  {
    label: 'Tokens',
    whatItShows:
      'The total number of tokens consumed across ALL agents (main + every subagent), including four token categories: uncached input, output, cache-creation input, and cache-read input.',
    source:
      'Summed in MissionBar.tsx: agents.reduce(sum, a => sum + a.tokensIn + a.tokensOut + a.cacheCreateTokens + a.cacheReadTokens, 0). Each per-agent field is accumulated in the server-side watcher on every assistant message: tokensIn += usage.input_tokens; tokensOut += usage.output_tokens; cacheCreateTokens += usage.cache_creation_input_tokens; cacheReadTokens += usage.cache_read_input_tokens. The usage object comes from the "usage" field of each assistant message in the JSONL transcript.',
    formula:
      'totalTokens = sum over all agents of (tokensIn + tokensOut + cacheCreateTokens + cacheReadTokens)',
    caveats:
      'The four token types are added together for the displayed total — they are NOT deduplicated. Cache-creation tokens and cache-read tokens count toward the total even though they are billed at different rates. Sidechain JSONL lines (entries where isSidechain === true) are skipped to avoid double-counting subagent traffic that appears in both the parent and child transcripts.',
  },
  {
    label: 'Est. Cost',
    whatItShows:
      'The estimated total USD cost across all agents for the current session.',
    source:
      'Each agent\'s estCostUsd is accumulated server-side on every assistant message in costForUsage() (src/server/pricing.ts), then summed in MissionBar.tsx: agents.reduce(sum, a => sum + a.estCostUsd, 0).',
    formula:
      'cost = (input_tokens × rate.input + output_tokens × rate.output + cache_creation_input_tokens × rate.cacheWrite + cache_read_input_tokens × rate.cacheRead) / 1_000_000. Rates (USD per 1M tokens) verified 2026-04-26: Opus 4.5+ — input $5, output $25, cacheWrite $6.25, cacheRead $0.50; Opus 4 / 4.1 (legacy) — input $15, output $75, cacheWrite $18.75, cacheRead $1.50; Sonnet 4.x — input $3, output $15, cacheWrite $3.75, cacheRead $0.30; Haiku 4.5 — input $1, output $5, cacheWrite $1.25, cacheRead $0.10; Haiku 3.5 — input $0.80, output $4, cacheWrite $1.00, cacheRead $0.08. Model is matched by checking whether the model string contains "opus", "sonnet", or "haiku" (case-insensitive), with version-aware sub-rates for Opus and Haiku.',
    caveats:
      'If the model name is absent or does not contain "opus", "sonnet", or "haiku", the cost contribution for that agent is $0.00 (tokens are still counted). Cost is an ESTIMATE using hardcoded published Anthropic pricing — actual billing may differ. Prices are defined in src/server/pricing.ts and must be edited there to update them.',
  },
  {
    label: 'Agent Status (active / idle / completed)',
    whatItShows:
      'The current activity state of each agent as shown in the agent panel and agent strip.',
    source:
      'Determined server-side by the watcher\'s refreshAgentStatus() method, which runs on every poll cycle (~750 ms). It reads the file modification time (mtime) of the agent\'s JSONL transcript.',
    formula:
      'If mtime age > 60 000 ms → status = "completed". If mtime age > 30 000 ms and current status is "active" → status = "idle". Status is set to "active" immediately whenever a new tool_use is seen in a new JSONL chunk.',
    caveats:
      'Status transitions are based on file modification time, not on explicit completion signals. An agent that stops writing to its transcript for 60 seconds will be marked "completed" even if it is still running.',
  },
  {
    label: 'Agent Phase (spawning / exploring / implementing / reporting / done)',
    whatItShows:
      'A higher-level description of what the agent is currently doing.',
    source:
      'Computed by detectPhase() in src/server/watcher/phaseDetector.ts, called after each new tool_use. It looks at the last ≤20 tool names the agent has used.',
    caveats:
      'Phase is a heuristic derived from tool-use patterns, not an explicit agent declaration. It can lag or misclassify if an agent\'s tool usage does not follow the expected patterns.',
  },
  {
    label: 'Tool Use Count',
    whatItShows:
      'How many tool calls an individual agent has made since it was first detected.',
    source:
      'Incremented by 1 in the watcher on every tool_use block found in an assistant message: toolUseCount: agent.toolUseCount + 1.',
    caveats:
      'Only counts calls seen from the beginning of the JSONL file (cold-start read) plus any new data appended since the watcher started. If the watcher missed earlier portions due to a restart, early calls may not be counted.',
  },
  {
    label: 'Last Action',
    whatItShows:
      'The most recent tool call made by an agent, shown as "ToolName path/to/file" when a file_path is available.',
    source:
      'Set on every tool_use to: `${block.name}${input.file_path ? ` ${input.file_path}` : ""}`. For TaskUpdate calls it appends the task ID instead of a file path.',
    caveats: 'Shows only the most recent call; older history is not retained.',
  },
  {
    label: 'Heartbeat / SSE Status',
    whatItShows:
      'Whether the browser is currently receiving live updates from the dashboard server. The heartbeat indicator pulses green when events are arriving; the SSE indicator shows "connected", "reconnecting", or "disconnected".',
    source:
      'The dashboard uses a Server-Sent Events stream (/api/events). The client store tracks sseStatus and lastEventReceivedAt. A ping message is sent periodically by the server to keep the connection alive.',
    caveats:
      'If the SSE connection drops, the dashboard stops receiving updates but retains the last known state. Reconnection is attempted automatically.',
  },
];
