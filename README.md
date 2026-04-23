# Mission Control

A real-time dashboard that observes and visualises Claude Code agent activity
in any project directory — token usage, cost estimates, task streams, and
team status at a glance.

> **Claude Code** (by Anthropic) is an AI coding assistant that runs specialist
> agents inside your terminal. Mission Control is a companion web app that
> makes those agents' activity visible.

---

## Features

- **Live activity stream** — every tool call, task, and status change via Server-Sent Events (SSE).
- **Token and cost tracking** — per-agent input/output/cache counts + estimated cost by model.
- **Task detail drawer** — click any agent or task for full prompt previews, tool history, and timing.
- **Team-kit drop-in** — ship a portable 8-agent team folder with your project; MC picks it up automatically.
- **Multi-host observation** — lightweight reporter on each machine, one dashboard for all activity.
- **Docker support** — one-command production build via `docker compose`.
- **Configurable branding** — rename the dashboard with a single env var.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 20.0.0 |
| pnpm | 10.32.1 (pinned via `packageManager` in `package.json`) |

Install pnpm if you don't have it: `npm install -g pnpm`

---

## Quick Start

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/jlab1201/mission-control/main/install.sh | bash
```

Clones into `./mission-control`, installs dependencies, and copies `.env.example` → `.env`. Override with `MC_INSTALL_DIR=/some/path` or `MC_REPO_URL=...`. Then:

```bash
cd mission-control
$EDITOR .env        # set WATCH_PROJECT_PATH to the project you want to observe
pnpm dev            # open http://localhost:10000
```

### Install as a systemd service (Linux, runs in background)

```bash
MC_AUTOSTART=systemd curl -fsSL https://raw.githubusercontent.com/jlab1201/mission-control/main/install.sh | bash
```

This builds for production (`pnpm build`), writes `~/.config/systemd/user/mission-control.service`, and runs `systemctl --user enable --now mission-control`. After install:

```bash
systemctl --user status mission-control        # check it's running
journalctl --user -u mission-control -f        # tail logs
systemctl --user restart mission-control       # after editing .env
```

To survive logout / reboot (recommended for servers), enable lingering once:

```bash
sudo loginctl enable-linger $USER
```

Requirements: Linux with systemd, an active user logind session (typical SSH logins via PAM qualify; bare `sudo -u` shells may not). For non-Linux or container hosts, use the Docker path in `docker/docker-compose.yml` instead.

### Manual install

```bash
git clone https://github.com/jlab1201/mission-control.git
cd mission-control
cp .env.example .env
# Edit .env — at minimum, set WATCH_PROJECT_PATH to the project you want to observe
pnpm install
pnpm dev
# Open http://localhost:10000
```

### Uninstall

Run from inside the Mission Control checkout:

```bash
./uninstall.sh              # interactive — asks before each step
./uninstall.sh --clean      # remove node_modules, .next, build artifacts only
./uninstall.sh --systemd    # stop & remove the systemd --user service
./uninstall.sh --docker     # also stop docker compose and remove its volumes
./uninstall.sh --full       # everything above + .env + the whole install dir
./uninstall.sh --yes        # skip confirmations (for scripting)
```

Safety:
- Refuses to run outside a Mission Control checkout (guards against running in the wrong directory).
- Warns before deleting `.env` (may contain your `WATCH_PROJECT_PATH` and other customizations).
- Never touches global Node.js, pnpm, or corepack — `install.sh` doesn't install those globally, so uninstall won't remove them. Use `nvm uninstall 20`, `brew uninstall node`, or your package manager to remove Node itself.

---

## Environment Variables

Copy `.env.example` to `.env`. Defaults are safe for local single-host use —
most installs only need to change `WATCH_PROJECT_PATH`.

Variables prefixed `NEXT_PUBLIC_` are bundled into the browser at build time;
they are **not** secret. Everything else is server-side only.

### Branding

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | `"Mission Control"` | Header and page title |
| `NEXT_PUBLIC_APP_DESCRIPTION` | `"Agent Mission Control Dashboard"` | Meta description |

### Watching

| Variable | Default | Description |
|---|---|---|
| `WATCH_PROJECT_PATH` | _(launch directory)_ | Absolute path to the project MC observes |
| `MC_TEAM_KIT_SOURCE` | `<MC install>/team-kit` | Path to agent definitions folder (only set if moved) |
| `MC_WATCH_SCRIPT_PATH` | `<MC install>/scripts/watch-agent.mjs` | Path to watch script (only set if moved) |

### Runtime Tunables

| Variable | Default | Description |
|---|---|---|
| `MC_POLL_INTERVAL_MS` | `750` | JSONL file poll interval (ms) |
| `MC_SSE_HEARTBEAT_MS` | `15000` | SSE keep-alive ping interval (ms) |
| `MC_AGENT_ACTIVE_THRESHOLD_MS` | `30000` | Time without event before agent is "idle" (ms) |
| `MC_AGENT_COMPLETED_THRESHOLD_MS` | `60000` | Time without event before agent is "completed" (ms) |
| `MC_JSONL_LOOKBACK_BYTES` | `786432` | Tail bytes read from each JSONL file on cold start |
| `MC_STATE_DIR` | `~/.mission-control/state` | Snapshot persistence directory |

### Networking / SSE

| Variable | Default | Description |
|---|---|---|
| `MC_MAX_SSE_CONNECTIONS` | `10` | Max concurrent SSE clients |
| `MC_MAX_REPLAY_EVENTS` | `500` | Events replayed on SSE reconnect |
| `NEXT_PUBLIC_MC_CLIENT_EVENT_LIMIT` | `200` | Browser-side event memory cap |

### Docker

| Variable | Default | Description |
|---|---|---|
| `MC_HOST_PORT` | `10000` | Host port bound on your machine |
| `MC_CONTAINER_PORT` | `10000` | Port the container listens on internally |

### Multi-Host (optional)

| Variable | Default | Description |
|---|---|---|
| `MC_HOST_ID` | `local` | Identifier for this MC install in the UI |
| `MC_HOST_LABEL` | _(none)_ | Human-friendly label (e.g. `"my-laptop"`) |
| `MC_INGEST_TOKENS` | _(empty)_ | Comma-separated bearer tokens for `/api/ingest`. Leave empty to disable ingest (single-host mode). Generate: `openssl rand -hex 32` |
| `MC_INGEST_RATE_BURST` | `100` | Max burst requests per token |
| `MC_INGEST_RATE_REFILL_PER_SEC` | `10` | Token bucket refill rate (req/s) |
| `MC_MAX_INGEST_BODY_BYTES` | `1048576` | Maximum ingest request body size |

---

## Dev Commands

```bash
pnpm dev          # Start dev server  →  http://localhost:10000
pnpm build        # Production build
pnpm start        # Start production server (after build)  →  http://localhost:10000
pnpm test         # Run unit tests (Vitest)
pnpm test:watch   # Watch mode
pnpm lint         # ESLint + TypeScript checks
```

---

## How It Works

Mission Control reads **JSONL log files** that Claude Code writes to the
watched directory. No database, no agents to install. The server polls these
files every `MC_POLL_INTERVAL_MS` milliseconds, parses token usage and tool
calls, and pushes deltas to the browser over SSE. The browser holds state in
memory (Zustand) — no page refresh needed.

- **Tokens** — from `usage.input_tokens`, `usage.output_tokens`, and `usage.cache_*` fields.
- **Cost** — an *estimate* computed in `src/lib/pricing.ts` using per-model prices. Not a billing figure.
- **Activity** — parsed from tool calls, assistant turns, and task completions in each JSONL entry.

For full details on every metric and how edge cases are handled, click the
**?** button in the top bar.

---

## Team-Kit

`team-kit/` is a portable folder you can drop into any project to give it a
pre-configured 8-agent Claude Code team (Team Lead, Frontend, Backend, DevOps,
QA, Security, Integrations, Context Monitor). Mission Control detects and
displays those agents automatically when `WATCH_PROJECT_PATH` points at a
project containing the team-kit.

See [team-kit/README.md](./team-kit/README.md) for setup instructions.

---

## Project Structure

```
src/app/api/        API routes (events, hosts, ingest, stats, stream, health, workspace)
src/server/         Watcher, JSONL parser, in-memory registry, SSE broadcaster, ingest
src/components/     Dashboard UI (React + Tailwind)
src/lib/            Config, pricing, theme, utilities
scripts/            setup.sh, watch-agent.mjs, build-reporter.mjs, mc-reporter.ts
team-kit/           Portable agent-team definitions (drop into any project)
docker/             Dockerfile + docker-compose.yml (production)
.github/workflows/  CI pipeline (lint, test, build)
docs/               Multi-host setup guide and planning notes
tests/              Unit + integration tests (Vitest)
```

---

## Docker

```bash
cd docker && docker compose up
```

Runs the production build. Host and container ports are configurable via
`MC_HOST_PORT` and `MC_CONTAINER_PORT` in your `.env`.

A `.dockerignore` at the repo root keeps `.env`, local databases, and the
`.git` directory out of the image — secrets never get baked in.

---

## Tech Stack

Next.js 15, React 18, TypeScript (strict), Tailwind CSS v4, Zustand, Framer
Motion, Pino, Zod, Vitest, Archiver.

---

## Security Posture

- **Single-host mode** (default): no authentication. Bind MC to `localhost` only — do not expose port 10000 publicly.
- **Multi-host mode**: `POST /api/ingest` requires a `Bearer` token set in `MC_INGEST_TOKENS`; tokens are compared with a timing-safe hash and rate-limited per token. Rotate by changing the env var.
- **Secrets never leave `.env`**: `.env` is gitignored, and `.dockerignore` excludes it from the Docker build context. Only `NEXT_PUBLIC_*` values reach the browser bundle.
- **Security headers**: HSTS, CSP, X-Frame-Options `DENY`, X-Content-Type-Options `nosniff`, Referrer-Policy, and a tight Permissions-Policy are emitted by `next.config.ts`.
- **Local state** lives under `MC_STATE_DIR` (default `~/.mission-control/state`).

Before exposing Mission Control beyond localhost, review `docs/multi-host-setup.md`
and rotate any `MC_INGEST_TOKENS` you have generated.

---

## Further Reading

- [Multi-host setup guide](docs/multi-host-setup.md)
- [Multi-host planning notes](docs/plans/multi-host.md)
- [Team-kit README](team-kit/README.md)
- [Agent team configuration (CLAUDE.md)](CLAUDE.md)

---

## License

MIT
