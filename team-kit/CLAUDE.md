# Project Instructions

> **This is a fresh team-kit CLAUDE.md.** The *Stack* and *File Ownership* sections near the bottom start as placeholders. The Team Lead is expected to **edit this file** during the initial planning pass — once the project idea and directory layout are decided, fill those two sections in and commit them. Everything above them is role-agnostic and applies to every project.

## Agent Team Configuration

This project uses Claude Code Agent Teams with 8 specialized agents (7 + context monitor). See `.claude/agents/` for all definitions.

### Team Structure

| Agent | File | Role | Model |
|-------|------|------|-------|
| **Team Lead** | `team-lead.md` | Orchestration, task breakdown, quality gates, context oversight | Opus |
| **Frontend Dev** | `frontend-dev.md` | UI, React, Next.js, styling, accessibility | Sonnet |
| **Backend Dev** | `backend-dev.md` | APIs, database, server logic, validation | Sonnet |
| **DevOps** | `devops-engineer.md` | CI/CD, Docker, deployment, monitoring | Sonnet |
| **QA Engineer** | `qa-engineer.md` | Testing, performance, accessibility audits | Sonnet |
| **Security** | `security-engineer.md` | Vulnerability scanning, auth, compliance | Sonnet |
| **Integrations** | `integration-specialist.md` | 3rd-party APIs, middleware, cross-cutting | Sonnet |
| **Context Monitor** | `context-monitor.md` | Context window health auditing | Haiku |

Not every project needs every specialist. A CLI tool may not need a Frontend Dev; a static site may not need a Backend Dev. The Team Lead decides which teammates to spawn based on the project idea.

---

## TASK LOGGING POLICY (REQUIRED)

**Every phase of every plan must be registered as a tracked task via `TaskCreate`.** The Mission Control dashboard reads these tool calls from the JSONL transcript — if no one calls `TaskCreate`, the task board stays empty even though real work is happening.

### Responsibilities

- **Team Lead** owns the task lifecycle. After the user approves a plan:
  1. Call `TaskCreate` once per phase (subject = phase name, description = what it delivers)
  2. Call `TaskUpdate` to set `owner` to the specialist responsible (`backend-dev`, `frontend-dev`, etc.)
  3. Call `TaskUpdate` with `status: 'in_progress'` when dispatching the phase
  4. Call `TaskUpdate` with `status: 'completed'` when the specialist reports done
  5. If a phase spawns sub-work, create additional sub-tasks via `TaskCreate` and keep their owners accurate

- **Specialists** do not call `TaskCreate` themselves. When finishing a phase, they **include the task id in their report** to the Team Lead so it can mark the task complete.

### Worked example

User approves a plan with two phases. Team Lead immediately runs (in order):

```
TaskCreate({ subject: "Phase 1 — workspace contracts", description: "types + route skeletons", activeForm: "Defining workspace contracts" })
  → returns Task #1

TaskCreate({ subject: "Phase 2 — install + watch endpoints", description: "inspect, install, config, teamkit.zip", activeForm: "Implementing workspace endpoints" })
  → returns Task #2

TaskUpdate({ taskId: "1", owner: "backend-dev", status: "in_progress" })
TaskUpdate({ taskId: "2", owner: "backend-dev" })  // stays pending until phase 1 is done
```

When Phase 1's specialist reports back, Team Lead runs:
```
TaskUpdate({ taskId: "1", status: "completed" })
TaskUpdate({ taskId: "2", status: "in_progress" })
```

### Why this is non-negotiable

Without task logging, the user can't see which phase is active, which agent owns it, or what's next. The task board becoming empty doesn't just look bad — it breaks the user's ability to supervise the team. Register tasks eagerly, not as an afterthought.

---

## CONTEXT MANAGEMENT POLICY (ALL AGENTS MUST FOLLOW)

Context mismanagement is the #1 cause of agent quality degradation. Every agent on this team follows these rules.

### The 200K Token Reality

Each agent has a 200K token context window. It fills with system prompts (~8K), file reads (~500-8K each), tool outputs (~200-5K each), and conversation history. When full, auto-compaction removes early instructions — causing agents to "forget" their role and standards.

### Universal Rules

1. **Subagents for exploration, direct work for implementation.**
   - Reading 3+ files to understand something → SUBAGENT
   - Running tests/builds and analyzing output → SUBAGENT
   - Making a targeted edit to a known file → DIRECT
   - Writing new code from a clear specification → DIRECT

2. **Every agent spawns `context-monitor` after completing 3-5 tasks.** Follow its recommendations (GREEN/YELLOW/ORANGE/RED classification).

3. **Proactive compaction.** Run `/compact` with a focus prompt BEFORE auto-compaction kicks in. Auto-compaction loses early instructions. Manual compaction preserves what you specify.

4. **Read with surgical precision.** Use `Grep` to find exact lines first. Use `offset` and `limit` on `Read` tool. Never read a 500-line file for 20 lines of relevant code.

5. **Report in summaries, never raw output.** When reporting results to the Team Lead or other agents, send concise findings — not raw logs, full test output, or complete file contents.

6. **Front-load high-value context.** Read shared types, interfaces, and CLAUDE.md first (small files, critical context). Delay large file reads until you have a specific target.

### Cost Reference

| Action | Context Cost | Strategy |
|--------|-------------|----------|
| Read small file (<100 lines) | ~500-1,500 tokens | OK to do directly |
| Read medium file (100-300 lines) | ~1,500-3,000 tokens | Use offset/limit when possible |
| Read large file (300+ lines) | ~3,000-8,000+ tokens | Delegate to subagent |
| Grep results | ~200-600 tokens | Always prefer Grep over Read for search |
| Test suite output | ~1,000-5,000 tokens | ALWAYS delegate to subagent |
| Build log output | ~1,000-3,000 tokens | ALWAYS delegate to subagent |
| Subagent summary | ~200-500 tokens | 10-30x cheaper than doing it yourself |

### Compaction Templates

Each agent should use a role-appropriate focus when running `/compact`:

- **Team Lead**: `/compact focus on: task assignments, API contracts, architectural decisions, remaining tasks`
- **Frontend**: `/compact focus on: component interfaces, design tokens, current task, remaining work`
- **Backend**: `/compact focus on: API contracts, DB schemas, validation rules, remaining tasks`
- **DevOps**: `/compact focus on: infra decisions, env vars, deployment targets, remaining tasks`
- **QA**: `/compact focus on: test patterns, coverage gaps, remaining test tasks, component APIs`
- **Security**: `/compact focus on: vulnerabilities found, severity ratings, fixes applied, remaining audit`
- **Integrations**: `/compact focus on: integration contracts, webhooks, middleware chain, remaining tasks`

---

## How to Use

### Start the full team
```
Create an agent team for [describe your feature].
Spawn teammates using the frontend-dev, backend-dev, devops-engineer,
qa-engineer, security-engineer, and integration-specialist agent types.
Require plan approval before any teammate makes changes.
```

### Use a single specialist
```
Use the backend-dev agent to design the database schema for user profiles.
```

### Workflow

1. Define contracts first (API shapes, DB schemas, component interfaces)
2. Parallel implementation (frontend + backend on agreed contracts)
3. QA pass (tests, accessibility, performance — via subagents for test execution)
4. Security audit (vulnerability scan, auth review — via subagents for codebase scanning)
5. Deploy (CI/CD pipeline, staging → production)

---

## Stack

<!-- TEAM LEAD: Fill this in during initial planning. -->
<!-- Decide based on the project idea the user described, then document: -->
<!-- - Language + version                                                -->
<!-- - Package manager                                                   -->
<!-- - Framework(s)                                                      -->
<!-- - Formatter / linter                                                -->
<!-- - Commit & branch conventions                                       -->
<!-- - Test runner                                                       -->
<!-- Once filled in, delete this comment block.                          -->

*To be filled in by the Team Lead during initial planning.*

---

## File Ownership (Conflict Prevention)

<!-- TEAM LEAD: Fill this in once the directory layout is decided.           -->
<!-- Every specialist you plan to spawn must own specific directories so two -->
<!-- agents never write to the same file at the same time. Shared files     -->
<!-- (package.json, tsconfig, env examples) are coordinated by the Team Lead. -->
<!-- Once filled in, delete this comment block.                              -->

*To be filled in by the Team Lead once the project directory layout is decided.*

---

### Compact Instructions

When compacting this conversation, ALWAYS preserve:
- The team structure and agent roles above
- The context management policy and rules
- The file ownership table (once filled in)
- The stack decisions (once filled in)
- Any API contracts or type definitions defined during the session
- The current task list and assignments
