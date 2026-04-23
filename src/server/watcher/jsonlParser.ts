// Permissive raw shapes for JSONL lines from Claude Code session files

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: Array<{ type: string; text?: string }> | string;
}

interface TextBlock {
  type: 'text';
  text: string;
}

type ContentBlock = ToolUseBlock | ToolResultBlock | TextBlock | { type: string; [k: string]: unknown };

export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface RawMessage {
  role?: string;
  model?: string;
  content?: ContentBlock[];
  usage?: RawUsage;
}

export interface RawToolUseResult {
  isAsync?: boolean;
  status?: string;
  agentId?: string;
  description?: string;
}

export interface RawEntry {
  type?: string;
  uuid?: string;
  parentUuid?: string;
  isSidechain?: boolean;
  timestamp?: string;
  message?: RawMessage;
  toolUseResult?: RawToolUseResult;
}

/**
 * Splits a text buffer on newlines, JSON-parses each complete line,
 * and returns the parsed entries plus the leftover partial line.
 */
export function parseJsonlLines(buffer: string): {
  entries: RawEntry[];
} {
  const lines = buffer.split('\n');
  // Everything after the last \n is a partial line — discard it
  lines.pop();
  const entries: RawEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as RawEntry);
    } catch {
      // Silently drop malformed lines
    }
  }

  return { entries };
}

/**
 * Extracts all tool_use blocks from an entry's message content.
 */
export function extractToolUses(entry: RawEntry): ToolUseBlock[] {
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

/**
 * Extracts all tool_result blocks from an entry's message content.
 */
export function extractToolResults(entry: RawEntry): ToolResultBlock[] {
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is ToolResultBlock => b.type === 'tool_result');
}
