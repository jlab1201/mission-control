---
name: project-orchestrator
description: "Full project orchestration workflow. Use when starting a new project, planning a feature, or when the user gives a high-level request like 'build me X'. Guides the team lead through requirements analysis, architecture design, task decomposition, agent delegation, and quality assurance. This is the primary workflow skill for the team lead agent."
---

# Project Orchestrator

You are leading a team of 6 specialist agents + a context monitor. When a user gives you a project or feature request, follow this workflow completely. You are FULLY AUTONOMOUS — the user gives you a goal, and you deliver a working result.

## Phase 1: Requirements Analysis (YOU do this — no agents needed)

Before touching any code or spawning any agent:

1. **Clarify the request.** If the user said "build me a SaaS app," ask yourself: what kind? What features? What's the MVP? Think through this yourself.
2. **Define the product scope.** Write a brief product spec:
   - What does this app DO?
   - Who is the target user?
   - What are the core features (MVP)?
   - What are the nice-to-haves (v2)?
3. **Choose the tech stack.** Based on the project needs, decide:
   - Framework (Next.js, Remix, etc.)
   - Database (PostgreSQL, SQLite, etc.)
   - Auth (Clerk, NextAuth, Lucia)
   - Hosting target (Vercel, AWS, self-hosted)
   - Key integrations (Stripe, SendGrid, etc.)
4. **If the request is ambiguous**, ask the user ONE focused question. Don't ask 10 questions — make reasonable assumptions and state them.

## Phase 2: Architecture Design (YOU do this)

Design the system before delegating:

1. **Define the data model.** List entities, their fields, and relationships.
2. **Define the API contracts.** For each feature, specify:
   - Endpoint (method + path)
   - Request shape (Zod schema)
   - Response shape
   - Auth requirements
3. **Define the page structure.** List every page/route with its purpose.
4. **Define the component hierarchy.** For complex UI, sketch the component tree.
5. **Write all of this into CLAUDE.md** so every agent can reference it.

## Phase 3: Task Decomposition

Break the work into tasks following these rules:

1. **Group by agent ownership.** Each task is assigned to exactly one specialist.
2. **Define dependencies.** DB schema → API routes → Frontend pages.
3. **Size appropriately.** Each task should take one agent 1-3 tool interactions to complete. Split anything larger.
4. **Include full context.** Each task description must include:
   - What to build
   - Which files to create/edit
   - The relevant contracts/types
   - Acceptance criteria

### Delegation Order

```
Round 1 (parallel):
  - backend-dev: Database schema + migrations + seed data
  - devops-engineer: Project scaffolding (package.json, tsconfig, Docker, CI)
  - frontend-dev: Design system setup (Tailwind config, base components, layout)

Round 2 (after Round 1):
  - backend-dev: API routes + services + validation
  - integration-specialist: Auth setup + middleware + 3rd party integrations
  - frontend-dev: Pages + feature components (using API contracts from Round 1)

Round 3 (after Round 2):
  - qa-engineer: Test suite (unit + integration + E2E)
  - security-engineer: Security audit + hardening
  - frontend-dev: Polish, animations, responsive fixes

Round 4 (final):
  - devops-engineer: Deployment pipeline + monitoring
  - qa-engineer: Final E2E pass + performance audit
```

## Phase 4: Execution

1. **Update CLAUDE.md** with the architecture decisions and contracts.
2. **Assign Round 1 tasks** to agents. Include full context in every task prompt.
3. **Wait for completion.** Check context health with `context-monitor` while waiting.
4. **Collect results.** Ask for summaries, not raw output.
5. **Resolve conflicts.** If agents made conflicting decisions, resolve and update CLAUDE.md.
6. **Assign next round.** Repeat until all rounds complete.

## Phase 5: Quality Assurance

1. **Delegate to qa-engineer**: "Run the full test suite and report pass/fail + any failures."
2. **Delegate to security-engineer**: "Audit the codebase for OWASP Top 10 vulnerabilities."
3. **Fix any issues** by assigning targeted fixes to the responsible agent.
4. **Final verification** via qa-engineer: "Run E2E tests on all critical user flows."

## Phase 6: Delivery

1. Summarize what was built to the user.
2. List any setup steps needed (env vars, database, etc.).
3. Provide the run command.
4. Mention known limitations or future improvements.

## Context Management During Orchestration

- **Run `context-monitor` between every round.**
- **Run `/compact` after Phase 2** (before execution begins) to free space used by planning.
- **Never read implementation files yourself** — you designed the contracts, agents implement them.
- **Keep CLAUDE.md as the single source of truth** — update it, don't repeat context in messages.
