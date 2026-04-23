---
name: context-management
description: "Context window management strategy for all agents. Loaded automatically when agents need guidance on when to use subagents, when to compact, how to read files efficiently, and how to preserve context health. Use when context feels heavy or before large tasks."
user-invocable: false
---

# Context Window Management

## The 200K Token Budget

Every agent session has 200,000 tokens. Here's how it fills:

| Phase | Tokens Used | Cumulative |
|-------|------------|------------|
| System prompt | ~4,200 | ~4,200 |
| CLAUDE.md + memory | ~2,500 | ~6,700 |
| MCP tools + skills (deferred) | ~600 | ~7,300 |
| Environment info | ~300 | ~7,600 |
| **Available for work** | **~192,000** | — |

## What Consumes Context

| Action | Token Cost | Frequency |
|--------|-----------|-----------|
| Read file (small, <100 lines) | 500-1,500 | Common |
| Read file (medium, 100-300 lines) | 1,500-3,000 | Common |
| Read file (large, 300+ lines) | 3,000-8,000+ | Avoid |
| Grep results | 200-600 | Cheap, prefer this |
| Glob results | 100-300 | Very cheap |
| Bash command output | 200-2,000 | Variable |
| Test suite full output | 1,000-5,000 | Expensive |
| Build log | 1,000-3,000 | Expensive |
| Your response text | 300-1,200 | Each turn |
| Subagent summary (returned) | 200-500 | Very cheap |

## The Golden Rule

**Subagent reads 10 files → costs 15,000 tokens in ITS context → returns 400-token summary to YOU → you save 14,600 tokens.**

Subagents are FREE to the parent's context (except for the small summary returned).

## Decision Matrix: Direct vs Subagent

| Task | Direct | Subagent | Why |
|------|--------|----------|-----|
| Read 1-2 small files | Yes | No | Cheap enough |
| Read 3+ files | No | Yes | Context adds up fast |
| Search with Grep | Yes | No | Very cheap |
| Explore/understand codebase | No | Yes | Exploration-heavy |
| Run tests | No | Yes | Output is huge |
| Run builds | No | Yes | Logs are huge |
| Make a targeted edit | Yes | No | One file, known location |
| Write new code | Yes | No | Creative work |
| Investigate a bug | No | Yes | Requires reading many files |
| Analyze dependencies | No | Yes | npm audit output is large |

## Efficient File Reading

```
BAD:  Read the entire 500-line file
GOOD: Grep for the function name, then Read with offset/limit

BAD:  Read 5 files to find a pattern
GOOD: Glob to find files, Grep for the pattern, Read only the matching sections

BAD:  Read implementation to understand the API
GOOD: Read the types/interfaces file (small, high-density context)
```

## When to Compact

Run `/compact` PROACTIVELY (before auto-compaction) when:
- You've completed 5+ tasks in a session
- You've read more than 10 files
- You're about to start a new phase of work
- Context-monitor reports YELLOW or worse

### Compaction Focus Templates

Always include a focus prompt:
```
/compact focus on: [role-specific items], current task, remaining work
```

## When to Worry

- **After 10+ file reads**: You've used ~15,000-30,000 tokens on file content alone
- **After running tests/builds directly**: Each one costs 1,000-5,000 tokens
- **Long conversations**: Each turn adds context. After 20+ turns, compact.
- **After loading multiple skills**: Skills stay in context after loading
