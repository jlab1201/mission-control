interface WatchAgentResponse {
  data?: { ok: boolean; window?: string };
  error?: { message: string };
}

/**
 * POST /api/agents/:agentId/watch — opens a tmux window for the agent.
 * Throws if the request fails or the server returns ok: false.
 */
export async function watchAgent(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/watch`, { method: 'POST' });
  const body = (await res.json()) as WatchAgentResponse;
  if (!res.ok || !body.data?.ok) {
    throw new Error(body.error?.message ?? 'Failed to open tmux window');
  }
}
