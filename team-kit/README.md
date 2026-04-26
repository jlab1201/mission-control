# Team Kit

A portable, drop-in Claude Code agent team. Copy this folder into any project directory and you instantly have 10 specialists (Team Lead + 6 devs + web-scraper + design-critic + context monitor), a context-management policy, and two kickoff workflows.

---

## What's inside

```
team-kit/
├── .claude/
│   ├── agents/          10 specialist definitions (team-lead, frontend-dev, backend-dev,
│   │                    devops-engineer, qa-engineer, security-engineer,
│   │                    integration-specialist, web-scraper, design-critic,
│   │                    context-monitor)
│   ├── skills/          13 reusable skill packs (ctx-mgmt, orchestrator, backend,
│   │                    frontend, devops, security, mcp-builder, web-testing,
│   │                    playwright-cli, web-builder, theme-factory, integrations,
│   │                    skill-dev)
│   ├── hooks/           PreToolUse security_reminder_hook.py — adapted from
│   │                    Anthropic's security-guidance plugin. Blocks file edits
│   │                    that introduce common XSS, code-injection, shell-injection,
│   │                    unsafe-deserialization, and CI-workflow-injection patterns.
│   │                    See skills/security/SKILL.md for the full rule list and
│   │                    the audit log location.
│   ├── settings.json    Permissions, agent-team flag, and the security hook wiring
│   └── agent-memory/    Empty — specialists populate this as they work
├── CLAUDE.md            Team config + context policy. Stack & File Ownership start
│                        as placeholders; the Team Lead fills them in during planning.
├── prompts/
│   ├── new-project.md   Kickoff ritual for building something from scratch
│   └── code-review.md   Kickoff ritual for auditing an existing codebase
└── README.md            (this file)
```

---

## How to start a NEW project

```bash
# 1. Make a fresh project directory
mkdir /path/to/your/project && cd /path/to/your/project

# 2. Drop the kit in (the trailing /. copies the contents, not the folder itself)
cp -r <mission-control-path>/team-kit/. .

# 3. Launch Claude Code here, then paste the contents of prompts/new-project.md
#    followed by your project idea.
claude
```

The Team Lead will ask you 3–5 questions, propose a stack, edit `CLAUDE.md` to fill in the stack + file ownership, spawn the specialists it needs, and present a plan. **Nothing gets coded until you say "execute."**

---

## How to REVIEW an existing project

```bash
# 1. Go to the project you want reviewed
cd /path/to/existing/project

# 2. Drop the kit in WITHOUT overwriting anything that already exists
cp -rn <mission-control-path>/team-kit/. .
```

> **`-n` = no-clobber.** If the project already has `.claude/` or `CLAUDE.md`, `cp -rn` will skip them and leave your existing files alone. If that happens and you actually want the kit's versions, move your existing ones aside first (`mv CLAUDE.md CLAUDE.md.backup`) and re-run the copy.

```bash
# 3. Launch Claude Code here, then paste the contents of prompts/code-review.md
claude
```

The Team Lead will orient itself, ask what to focus on, spawn specialists in **read-only** mode, aggregate findings into a prioritized report, and propose a remediation plan. **Nothing gets fixed until you say "execute."**

---

## How to watch progress in Mission Control

Mission Control normally watches *its own* directory. To point it at the project the team is working on, start the dev server with the `WATCH_PROJECT_PATH` env var:

```bash
WATCH_PROJECT_PATH=/path/to/your/project \
  pnpm --prefix <mission-control-path> dev
```

Then open the dashboard at `http://localhost:3000` (or whatever port MC uses). You should see the "current cwd" match the project path you set, and any agent activity will stream in real time.

To watch **two projects at once**, run two Mission Control instances on different ports — each with its own `WATCH_PROJECT_PATH`. True simultaneous multi-project support (project switcher, persistence, cross-project history) is deliberately not built yet; it'll come if you ever actually need it.

---

## How to update the kit

When you improve an agent definition or a skill while working on a real project, fold it back into the kit so every future project benefits:

```bash
# Example: you improved backend-dev.md in /path/to/your/project
cp /path/to/your/project/.claude/agents/backend-dev.md \
   <mission-control-path>/team-kit/.claude/agents/backend-dev.md
```

Do **not** copy anything from `agent-memory/` back into the kit — those files are project-specific and would contaminate future projects.

---

## FAQ

**Q: Why is the `Stack` section of `CLAUDE.md` blank?**
Because the Team Lead picks it per project based on your idea. You're not a coder — you shouldn't have to commit to TypeScript vs Python vs Go before you've even described what you want. The Team Lead decides, then writes the decision into `CLAUDE.md` so every teammate follows it.

**Q: What if I drop the kit into a project that already has a `CLAUDE.md`?**
`cp -rn` will preserve your existing one. The Team Lead will read whatever `CLAUDE.md` it finds. You can merge the two manually if you want the context-management policy from the kit's version.

**Q: Is this a git repo?**
No. The kit is a folder, not a repo. When you drop it into a new project, any `.git` you already have stays untouched.

**Q: Where does the team's memory go?**
Each specialist writes to `.claude/agent-memory/<agent-name>/` inside the project it's working on. Memory stays with the project it belongs to — it never leaks back into the kit or into Mission Control.
