# Multi-Host Mission Control — Implementation Plan

> **Status**: Ready to execute · **Author**: planning session 2026-04-23 · **Target**: fresh Claude Code session
>
> This file is a self-contained blueprint. A new session reading this file + the current repo should be able to deliver the feature without further clarification. If something is ambiguous while executing, follow the "When in doubt" rules at the end before asking.

---

## 0. How to use this plan

1. Read this whole file first. Do **not** start coding before reading Sections 1-5.
2. Run `pnpm install` if `node_modules` is stale, then `pnpm test` to confirm a green baseline before touching anything.
3. Follow the rounds in Section 6 **in order**. Agents inside the same round run in parallel; rounds are sequential.
4. After each round, run `pnpm tsc --noEmit && pnpm lint && pnpm test` before starting the next round. If something breaks, fix inside the round that caused it — do not cascade into the next.
5. The team lead / orchestrator owns: task dispatch, CLAUDE.md updates, conflict resolution, and the final ship decision.

---

## 1. Current architecture (context for the new session)

Mission Control (MC) is a Next.js 15 / React 18 / TypeScript dashboard that observes Claude Code agent activity by parsing JSONL transcript files on the **local** filesystem.

**Data flow today (single-host):**

```
~/.claude/projects/<slug>/session.jsonl   ┐
~/.claude/projects/<slug>/subagents/*.jsonl ├─► src/server/watcher/* (poll + tail)
                                           │     └─► registry (in-memory Map)
                                           │           └─► SSE /api/stream ──► client (Zustand store)
                                           └─► src/server/persistence/snapshotStore.ts
                                                     (persists to ~/.mission-control/state)
```

**Key files (with LOC for context — don't re-read unnecessarily):**

| File | LOC | What it does |
|---|---|---|
| `src/server/watcher/index.ts` | 119 | Boot + poll loop (750 ms) |
| `src/server/watcher/sessionLocator.ts` | 101 | Resolves watched project dir via config → `WATCH_PROJECT_PATH` → `cwd()` |
| `src/server/watcher/jsonlParser.ts` | 95 | Parses JSONL, extracts tool_use / tool_result / usage |
| `src/server/watcher/incrementalReader.ts` | 110 | Tails files by byte offset |
| `src/server/watcher/mainSessionWatcher.ts` | 405 | Watches main session JSONL; resolves Agent tool spawns; ensures team placeholders |
| `src/server/watcher/subagentWatcher.ts` | 335 | Watches `subagents/*.jsonl`; updates agent state, tokens, cost |
| `src/server/watcher/registry.ts` | 236 | In-memory registry, SSE broadcast, snapshot persistence |
| `src/server/watcher/teamMatcher.ts` | 49 | Role-aware matcher for task owners vs real agents |
| `src/server/pricing.ts` | — | Per-model token pricing → `estCostUsd` |
| `src/app/api/stream/route.ts` | — | SSE endpoint, reconnect replay via `?since=N` |
| `src/types/index.ts` | — | `Agent`, `AgentEvent`, `Task`, `MissionSnapshot`, `RegistrySnapshot`, `SSEMessage` |
| `src/lib/store/missionStore.ts` | — | Client Zustand store |
| `src/components/features/MissionBar.tsx` | — | Top bar with stats, project selector, help button |
| `src/components/features/AgentStrip.tsx` | — | Per-agent card row |

**What doesn't exist yet:** any concept of a host other than "this machine". Every agent implicitly belongs to the machine running MC.

**Existing env vars** (`.env.example` is authoritative; don't re-enumerate here except where we're adding).

---

## 2. Goal

Let one MC dashboard observe Claude Code activity on **multiple machines** by having each remote machine run a lightweight reporter that pushes parsed events to the central MC over HTTP(S) with a bearer token.

**Non-goals for this iteration:**

- Per-host auth/accounts (single shared token list is fine for v1).
- Cross-host task correlation (tasks stay scoped to the host that emits them).
- Pulling historical data from hosts — reporter only forwards live events going forward, plus one initial snapshot.
- TLS termination — MC relies on whatever the operator puts in front (Vercel, nginx, Caddy). We just warn in docs if the target URL is `http://`.
- ~~Web UI for configuring reporters~~ → **In scope for v1 (added 2026-04-24):** MC serves a bundled, dependency-free `mc-reporter.mjs` at a stable path, and the dashboard surfaces a "Connect a host" modal with a copy-paste install one-liner and an env-var template. Reporters are still configured via env vars / CLI flags on the remote side; the UI just shortens the copy-paste setup.

---

## 3. Architecture decisions

### 3.1 Topology

```
  [Host A: Claude Code]        [Host B: Claude Code]        [Host C: MC + Claude Code]
         │                             │                              │
    mc-reporter.mjs              mc-reporter.mjs                (local watcher)
         │ HTTPS POST                  │ HTTPS POST                    │
         └─────────┬───────────────────┘                               │
                   ▼                                                    ▼
              [MC server] ──── /api/ingest ──────────────► registry (shared)
                                                                        │
                                                                        ▼
                                                                  SSE clients
```

The reporter is **push-only**. It never opens inbound ports; MC only has one new inbound endpoint. Firewalls / NAT just work.

### 3.2 Data model additions

Add to `Agent` and `AgentEvent`:

```ts
hostId: string;       // stable short identifier, e.g. "laptop", "prod-vm-1"
hostLabel?: string;   // optional human-friendly display name
```

Add to `MissionStats`:

```ts
hosts: Array<{
  hostId: string;
  hostLabel?: string;
  lastSeenAt: string;     // ISO timestamp of latest event/update
  agentCount: number;     // all types
  activeAgentCount: number;
}>;
```

Bump `RegistrySnapshot.version` from `1` to `2`. `registry.hydrate()` auto-migrates v1 snapshots by stamping every agent/event with `hostId = MC_HOST_ID ?? "local"`.

### 3.3 API contract — `POST /api/ingest`

**Auth**: `Authorization: Bearer <token>`. On first use, every entry in `MC_INGEST_TOKENS` (comma-separated) is SHA-256 hashed once and cached keyed by the env value. On each request, the caller's token is SHA-256 hashed and compared against the cached 32-byte digests with `crypto.timingSafeEqual` — both buffers are the same length by construction, **no padding**. Never compare raw tokens with padding; padding length leaks token length. If `MC_INGEST_TOKENS` is empty or unset, the endpoint returns `503 ingest-disabled` — **ingest is off by default**.

**Request** (Zod schema in `src/server/ingest/schema.ts`):

```ts
{
  hostId: string;            // ^[a-zA-Z0-9_-]{1,64}$
  hostLabel?: string;        // ≤64 chars, free-form
  mode: 'snapshot' | 'delta';
  payload: {
    agents?: Agent[];        // full state for this host if snapshot, changed agents if delta
    events?: AgentEvent[];   // always appended
    tasks?: Task[];
    removedAgentIds?: string[];  // delta-only — agents to evict (e.g. cleaned-up team placeholders)
  };
}
```

Body cap: **5 MB** (rejected with 413 if larger). The cap is enforced **before** parsing — the handler streams `request.body.getReader()`, accumulates bytes, and aborts with 413 as soon as the threshold is crossed. It must NOT call `request.json()` on untrusted input (that drains the whole body with no cap and exposes a JSON-bomb surface). See Task 2.1 step 6 for the exact pattern.

**Response**:

```ts
// 200 OK
{ accepted: true, ingestedAgents: number, ingestedEvents: number, serverSeq: number }

// 401 unauthorized | 400 validation | 413 too-large | 503 ingest-disabled | 429 rate-limited
{ error: { code: string, message: string } }
```

**Server behavior**:

- `snapshot` mode: replaces **all** agents for this `hostId` in the registry (removes agents belonging to `hostId` that aren't in the payload). Preserves agents from other hosts.
- `delta` mode: upserts agents, appends events, removes listed `removedAgentIds`.
- Every ingested agent/event is stamped with the caller's `hostId` **server-side**, regardless of what the payload says on each row — payload-level hostId is only used for routing.
- Events keep their reporter-supplied `timestamp` but get a fresh server-assigned `seq`.
- Ingest payloads are applied inside `registry.applyBatch(fn)` (Task 1.1 step 5), which suspends per-row `agent:update` / `task:replace` / `event:new` broadcasts AND `scheduleSave` calls while `fn` runs, then flushes once at the end: at most one coalesced `stats:update`, the deduped per-id update/delete frames, one `event:new` per event, and exactly one `scheduleSave`. Without this, a 20-agent snapshot from one reporter tick fans out 20 SSE frames + 20 full-snapshot disk re-serializations, which at N hosts × 1 s cadence will DoS the SSE stream and hammer the persistence file.

**Rate limiting**: per-token, token-bucket in memory: 100 requests / 10 s burst, refill 10/s. Reject with `429` on overflow. Default tunables via env (`MC_INGEST_RATE_BURST`, `MC_INGEST_RATE_REFILL_PER_SEC`).

### 3.4 API contract — `GET /api/hosts`

Returns the host list for the UI selector:

```ts
// 200 OK
{
  hosts: Array<{
    hostId: string;
    hostLabel?: string;
    lastSeenAt: string;
    agentCount: number;
    activeAgentCount: number;
    isLocal: boolean;       // true for MC's own host
  }>
}
```

Always includes the local host. Pulls from a new `hostRegistry` (see Section 4).

### 3.5 Reporter design

`scripts/mc-reporter.ts` is a TypeScript ESM script run via `tsx` (added as a devDependency in Task 1.3). It imports helpers from `../src/server/watcher/watcherCore.ts` using **relative paths only** — `tsx` does not resolve `@/...` tsconfig aliases at runtime, so the file must not use them, and `watcherCore.ts` itself must not use them inside its own body either. `watcherCore.ts` is **registry-free**: it must not transitively import `registry.ts`, `@/lib/eventBus`, `@/server/persistence/snapshotStore`, or any Next-coupled runtime module (enforced in Task 1.2 acceptance). The reporter has zero runtime deps beyond Node built-ins + `tsx`. Dev invocation: `pnpm tsx scripts/mc-reporter.ts`.

**Distributable bundle (added 2026-04-24):** `pnpm build:reporter` runs `esbuild` over `scripts/mc-reporter.ts` with `--bundle --platform=node --format=esm --target=node20 --outfile=public/mc-reporter.mjs`. The result is a single file with zero external runtime dependencies (Node built-ins only). `pnpm build` runs `build:reporter` automatically before `next build`, so the bundle is always fresh next to the Next static assets. Operators on remote machines only need Node 20+ — no `pnpm install`, no `tsx`, no repo clone.

**Download endpoint:** `public/mc-reporter.mjs` is served by Next.js as a static file at `/mc-reporter.mjs`. No auth on the file itself (it's just a client script — the bearer token is still required to actually POST to ingest). The file includes a leading comment block with the MC version it was bundled from and a link to the setup docs.

**"Connect a host" UI:** the dashboard exposes a modal in `MissionBar` (next to the help button, gated behind `MC_INGEST_TOKENS` being non-empty) with:
- The download one-liner: `curl -fSLO http://<this-mc-host>/mc-reporter.mjs` (the modal reads `window.location.origin` to prefill).
- The run one-liner: `MC_REPORTER_TARGET_URL=<origin> MC_REPORTER_TOKEN=... MC_REPORTER_HOST_ID=... node mc-reporter.mjs`.
- A "generate token" helper that shows `openssl rand -hex 32` (generated client-side via `crypto.getRandomValues` — the user must paste it into MC's `.env` under `MC_INGEST_TOKENS=` and restart; no server-side token minting in v1).
- A link to `docs/multi-host-setup.md`.

**Responsibilities:**

1. Resolve local project path exactly like MC does today (same config → env → cwd chain, refactored into a shared helper).
2. Watch the local project's session + subagent JSONL files (reuse existing tailer).
3. Maintain its own in-memory view of agents/events.
4. Periodically POST to `${MC_REPORTER_TARGET_URL}/api/ingest`:
   - Send a `snapshot` every `MC_REPORTER_SNAPSHOT_INTERVAL_MS` (default 30 s).
   - Send a `delta` every `MC_REPORTER_BATCH_INTERVAL_MS` (default 1 s) if anything changed.
5. On HTTP failure: exponential backoff (1 s → 30 s cap), retry forever. Buffer unsent deltas up to 500 events; if buffer overflows, drop oldest and log a warning.
6. On `ENOTFOUND` / connection refused: same backoff, same behavior.
7. Log to stderr in a compact format: `[mc-reporter] <ts> <level> <msg>`.
8. Graceful shutdown: on SIGINT/SIGTERM, flush one last delta with `{ mode: 'snapshot' }` so MC knows the final state, then exit.

**CLI / env:**

```
MC_REPORTER_TARGET_URL        required  e.g. https://mc.example.com
MC_REPORTER_TOKEN             required  must match one entry in MC_INGEST_TOKENS on server
MC_REPORTER_HOST_ID           required  short id, ^[a-zA-Z0-9_-]{1,64}$
MC_REPORTER_HOST_LABEL        optional  display name
WATCH_PROJECT_PATH            optional  defaults to cwd (same as MC)
MC_REPORTER_BATCH_INTERVAL_MS optional  default 1000
MC_REPORTER_SNAPSHOT_INTERVAL_MS optional  default 30000
MC_REPORTER_HTTP_TIMEOUT_MS   optional  default 10000
```

Invocation: `node scripts/mc-reporter.mjs` (env-driven). Or: `node scripts/mc-reporter.mjs --help` prints usage.

### 3.6 UI changes

**New component** `src/components/features/HostSelector.tsx`:

- Renders only when `hosts.length > 1` (hidden in single-host mode for zero visual regression).
- Dropdown in top-right of MissionBar showing "All hosts (N)" + each host with its `hostLabel || hostId` and a small dot indicating freshness (green < 30 s since lastSeenAt, amber < 2 min, red older).
- Selection stored in the client store as `selectedHostId: string | null` (`null` = all).

**Client store**: add `selectedHostId` state and `setSelectedHostId` action in `missionStore.ts`. Add `selectFilteredAgents(state)` selector that applies the filter.

**Existing consumers** (AgentStrip, AgentPopover, AgentPanel, MissionBar stats): read from `selectFilteredAgents` instead of raw `agents` array.

**Host badge** on agent cards (AgentStrip, AgentPopover): a tiny pill with `hostLabel || hostId`, hidden when `hosts.length === 1`. Visual style matches existing `phase` pill.

### 3.7 Backward compatibility

- When `MC_INGEST_TOKENS` is empty, there's one host (local), no HostSelector shown, no badges shown, no behavioral change for existing users.
- Snapshot v1 → v2 migration is one-pass on boot, no user action needed.
- Existing `/api/stream` SSE contract unchanged except that `Agent` / `AgentEvent` payloads now carry `hostId`. Clients on the old schema would simply ignore extra fields — but we own the client, so we update it.

---

## 4. File manifest

### New files

| Path | Owner | Purpose |
|---|---|---|
| `src/server/ingest/auth.ts` | backend | Timing-safe bearer token check against `MC_INGEST_TOKENS` |
| `src/server/ingest/schema.ts` | backend | Zod schemas for ingest payloads |
| `src/server/ingest/ingestHandler.ts` | backend | Apply snapshot/delta to registry, stamp hostId |
| `src/server/ingest/hostRegistry.ts` | backend | Track known hosts + last-seen timestamps |
| `src/server/ingest/rateLimit.ts` | backend | Per-token token-bucket rate limiter |
| `src/app/api/ingest/route.ts` | backend | Next.js route handler wiring auth + handler |
| `src/app/api/hosts/route.ts` | backend | GET hosts list for UI |
| `src/server/watcher/watcherCore.ts` | backend | Extracted shared parsing/reading helpers (imported by both MC watcher and reporter) |
| `scripts/mc-reporter.ts` | backend + devops | Remote reporter script, run via `pnpm tsx scripts/mc-reporter.ts` in dev |
| `scripts/mc-reporter.test.ts` | qa | Smoke test for the script (boots, POSTs once to a mock server, exits) |
| `scripts/build-reporter.mjs` | devops | esbuild driver that bundles the reporter into `public/mc-reporter.mjs` |
| `public/mc-reporter.mjs` | (generated) | Committed-generated or build-time artifact — single-file reporter bundle served at `/mc-reporter.mjs` |
| `src/components/features/ConnectHostModal.tsx` | frontend | "Connect a host" dialog with download + run one-liners |
| `src/components/features/HostSelector.tsx` | frontend | Top-bar dropdown |
| `src/components/features/HostBadge.tsx` | frontend | Tiny host pill used on agent cards |
| `docs/multi-host-setup.md` | integration | User-facing setup guide |
| `tests/integration/ingest.test.ts` | qa | Auth, validation, snapshot vs delta, rate-limit |
| `tests/unit/hostRegistry.test.ts` | qa | Host tracking logic |
| `tests/unit/ingestHandler.test.ts` | qa | Payload → registry mutations |

### Modified files

| Path | Change |
|---|---|
| `src/types/index.ts` | Add `hostId`, `hostLabel` to `Agent` + `AgentEvent`; add `hosts` to `MissionStats`; bump `RegistrySnapshot.version` to 2; update `SSEMessage` if host list broadcast is added |
| `src/server/watcher/registry.ts` | Stamp `hostId` on all local agents/events; v1→v2 hydrate migration; expose `getByHost(hostId)`, `removeByHost(hostId, exceptIds)` helpers; new host stats in `computeStats()` |
| `src/server/watcher/index.ts` | Stamp local `MC_HOST_ID` (default `"local"`) on the main + any agents it creates |
| `src/server/watcher/mainSessionWatcher.ts` | Pass hostId through to agents/events created here |
| `src/server/watcher/subagentWatcher.ts` | Pass hostId through to subagent placeholders and events |
| `src/server/watcher/teamMatcher.ts` | Scope team placeholders to hostId so two hosts with "frontend" owners don't collide |
| `src/lib/store/missionStore.ts` | `selectedHostId` state + filter selector |
| `src/hooks/useSSE.ts` | No change required (agents now carry hostId naturally) |
| `src/components/features/MissionBar.tsx` | Mount HostSelector when >1 host |
| `src/components/features/AgentStrip.tsx` | Show HostBadge when >1 host |
| `src/components/features/AgentPopover.tsx` | Show HostBadge; use filtered agents |
| `src/components/features/AgentPanel.tsx` | Use filtered agents |
| `src/lib/config/helpContent.ts` | Add Hosts entry; update Agents / Subagents entries to mention host scoping |
| `.env.example` | Add all new vars (see Section 5) |
| `README.md` | One-paragraph multi-host blurb + link to `docs/multi-host-setup.md` |
| `src/lib/config/runtime.ts` | Add `MC_INGEST_RATE_BURST`, `MC_INGEST_RATE_REFILL_PER_SEC`, `MC_MAX_INGEST_BODY_BYTES` constants |
| `package.json` | Add `tsx` as devDependency (required by Task 1.2 smoke check and Task 3.1 reporter) |

---

## 5. Env vars (complete list for `.env.example`)

Add these under a new `# === Multi-host ===` section:

```bash
# === Multi-host ===
# Identifier for this MC install's own host. Appears as the "local" host in the UI.
MC_HOST_ID=local

# Human-friendly label for MC's own host (optional).
# MC_HOST_LABEL="my-laptop"

# Comma-separated bearer tokens accepted at /api/ingest. Leave empty to disable
# ingest entirely (single-host mode). Generate with: openssl rand -hex 32
# MC_INGEST_TOKENS=

# Max /api/ingest body size in bytes (default 5 MB).
MC_MAX_INGEST_BODY_BYTES=5242880

# Rate limit burst per token (default 100).
MC_INGEST_RATE_BURST=100

# Rate limit refill rate per second per token (default 10).
MC_INGEST_RATE_REFILL_PER_SEC=10
```

For the reporter (goes in the reporter's own `.env` on each remote host — document in `docs/multi-host-setup.md`, NOT in MC's `.env.example`):

```bash
MC_REPORTER_TARGET_URL=https://mc.example.com
MC_REPORTER_TOKEN=<shared-secret>
MC_REPORTER_HOST_ID=laptop
MC_REPORTER_HOST_LABEL="My Laptop"
WATCH_PROJECT_PATH=/path/to/project
MC_REPORTER_BATCH_INTERVAL_MS=1000
MC_REPORTER_SNAPSHOT_INTERVAL_MS=30000
MC_REPORTER_HTTP_TIMEOUT_MS=10000
```

---

## 6. Execution plan — rounds

Each round's tasks run **in parallel**. Wait for all tasks in a round to report before starting the next. After every round, run the green-check: `pnpm tsc --noEmit && pnpm lint && pnpm test`.

### Round 1 — Foundations (parallel × 3)

#### Task 1.1 — backend-dev — Types + registry migration

**Owns**: `src/types/index.ts`, `src/server/watcher/registry.ts`, `src/server/watcher/index.ts`, `src/server/watcher/mainSessionWatcher.ts`, `src/server/watcher/subagentWatcher.ts`, `src/server/watcher/teamMatcher.ts`

**Do**:
1. Add `hostId: string` and `hostLabel?: string` to `Agent` and `AgentEvent` in `types/index.ts`.
2. Add `hosts: Array<{ hostId, hostLabel?, lastSeenAt, agentCount, activeAgentCount }>` to `MissionStats`.
3. Bump `RegistrySnapshot.version` from `1` to `2`: widen the type to `version: 1 | 2` (so hydrate can still read old files) AND **update the literal in `toSnapshot()` at `src/server/watcher/registry.ts:171` to write `2`**. Newly-persisted snapshots are always v2.
4. In `registry.hydrate()`, detect `version === 1` and stamp every agent/event with `hostId = process.env.MC_HOST_ID ?? 'local'` (and `hostLabel` from `MC_HOST_LABEL`).
5. Add helpers on `Registry`:
   - `getByHost(hostId: string): Agent[]`
   - `removeByHost(hostId: string, exceptIds: Set<string>): string[]` — returns deleted IDs; broadcasts `agent:delete` for each.
   - `applyBatch<T>(fn: () => T): T` — sets an internal `inBatch` flag, runs `fn`, then flushes once: exactly one coalesced `stats:update`, the accumulated `agent:update` / `task:replace` / `event:new` / `agent:delete` frames (deduped by id — keep the last value), and a **single** `scheduleSave`. While `inBatch` is true, `upsertAgent` / `upsertTask` / `addEvent` / `removeAgent` enqueue into a per-batch buffer instead of broadcasting/saving. This is the primitive `ingestHandler.ts` uses so a 20-agent reporter snapshot produces one SSE batch + one disk write, not 20 of each. Unit-test: 50 upserts inside `applyBatch` produce exactly 1 `scheduleSave` call and at most 1 `stats:update`.
   - `clearLocal(hostId: string): void` — used by `restartWatcher()`. Calls `removeByHost(hostId, new Set())`, wipes local-owned tasks and events (events where `hostId` matches), resets `sessionId` / `cwd` / `lastSeq` **only if no remote hosts remain**. If remote hosts are present, keep `lastSeq` monotonic so reconnecting SSE clients don't see seq regress.
6. In `computeStats()`, build the `hosts` summary from `this.agents`.
7. In the three watcher files, stamp **every** `registry.upsertAgent` and `registry.addEvent` call with `hostId` from `process.env.MC_HOST_ID ?? 'local'` and `hostLabel` from `MC_HOST_LABEL`. Use the `localHostId()` / `localHostLabel()` helpers exported from `watcherCore.ts` (Task 1.2 lands the file; until it does, inline both helpers at the top of each watcher file and refactor once Task 1.2 is in — this is intentional churn to keep Round 1 parallelizable).
8. In `teamMatcher.ts`, scope `reconcileTeamPlaceholders` per-host: only clean up team placeholders whose hostId matches a real agent on the **same** host. Pass `hostId` through or filter inside the function.
9. **Scope `restartWatcher()` to local-only state.** `src/server/watcher/index.ts:30` currently calls `registry.clear()` on every local project switch — in multi-host mode that wipes every remote host from both memory and the persistence snapshot (since `scheduleSave` fires afterwards). Replace `registry.clear()` with `registry.clearLocal(localHostId())` (new helper in step 5 above). After the swap: switching the locally-watched project does not affect remote-host agents/tasks/events, `/api/workspace/watch` remains functional, and the single-host case behaves identically to today.

**Acceptance**:
- `pnpm tsc --noEmit` clean.
- Existing tests still pass (they'll need minor fixture updates — add `hostId: 'local'` to any mocked agent/event).
- A v1 snapshot file on disk hydrates without errors and every agent has `hostId: 'local'` after boot.

**Do NOT**:
- Build the ingest endpoint (Task 2.1).
- Touch UI files.

---

#### Task 1.2 — backend-dev — Watcher core extraction

**Owns**: `src/server/watcher/watcherCore.ts` (new), plus minor edits to `mainSessionWatcher.ts`, `subagentWatcher.ts`, `sessionLocator.ts`, `incrementalReader.ts` to re-export / import from the core.

**Do**:
1. Create `src/server/watcher/watcherCore.ts` that re-exports / owns:
   - `resolveWatchedProjectPath()` — the config → `WATCH_PROJECT_PATH` → cwd chain currently in `sessionLocator.ts`.
   - `encodeProjectPath()` — already in `sessionLocator.ts`.
   - `IncrementalReader` (re-export from `incrementalReader.ts`).
   - `parseJsonlLines`, `extractToolUses`, `extractToolResults` (re-export from `jsonlParser.ts`).
   - `localHostId()` — reads `process.env.MC_HOST_ID ?? 'local'`.
   - `localHostLabel()` — reads `process.env.MC_HOST_LABEL` (or undefined).
2. Update `mainSessionWatcher.ts`, `subagentWatcher.ts` imports to use `./watcherCore` where it's cleaner, but **do not refactor logic** — this task is about extraction, not redesign.
3. Confirm `scripts/mc-reporter.mjs` (to be built in Round 3) can `import` from this module without pulling in Next-specific code. If the file accidentally transitively imports a Next-only module, split differently.

**Acceptance**:
- `pnpm tsc --noEmit` clean.
- `pnpm test` green.
- `watcherCore.ts` uses **relative imports only** inside its own body — zero `@/...` aliases in the file (grep check).
- **Registry-free**: grep `src/server/watcher/watcherCore.ts` — must not reference `registry`, `eventBus`, `snapshotStore`, `scheduleSave`, or any file under `src/lib/config/runtime.ts`. If a helper needs a tunable, take it as a function parameter rather than importing the constant.
- Smoke check: `pnpm tsx -e "import('./src/server/watcher/watcherCore.ts').then(m => console.log(Object.keys(m).sort()))"` prints the expected exports (`IncrementalReader`, `encodeProjectPath`, `extractToolResults`, `extractToolUses`, `localHostId`, `localHostLabel`, `parseJsonlLines`, `resolveWatchedProjectPath`) and exits 0 with no boot-time side effects (no file watching, no registry mutation).

---

#### Task 1.3 — devops-engineer — Env + config + tsx

**Owns**: `.env.example`, `src/lib/config/runtime.ts`, `package.json`

**Do**:
1. Add the `# === Multi-host ===` section to `.env.example` exactly as in Section 5 of this plan.
2. Add to `src/lib/config/runtime.ts`:
   ```ts
   export const MAX_INGEST_BODY_BYTES = numEnv('MC_MAX_INGEST_BODY_BYTES', 5_242_880);
   export const INGEST_RATE_BURST = numEnv('MC_INGEST_RATE_BURST', 100);
   export const INGEST_RATE_REFILL_PER_SEC = numEnv('MC_INGEST_RATE_REFILL_PER_SEC', 10);
   ```
3. Do **not** add `MC_INGEST_TOKENS` as a runtime constant — it's read dynamically inside the auth module (supports env changes without restart during dev). Just document it in `.env.example`.
4. `pnpm add -D tsx` — required by Task 1.2's smoke check and Task 3.1's reporter script. Pin to the latest stable minor (e.g. `^4.x`). Commit both `package.json` and `pnpm-lock.yaml`.
5. Add an `engines` field to `package.json`: `"engines": { "node": ">=20.0.0" }` — `fetch` + `ReadableStream.getReader()` patterns we're relying on are stable on Node 20+. Document in the reporter `--help` output (Task 3.1) too.

**Acceptance**:
- `pnpm tsc --noEmit` clean.
- `.env.example` renders cleanly, all comments grammatical, example values sane.

---

### Round 2 — Ingest surface (parallel × 2)

#### Task 2.1 — backend-dev — Ingest endpoint + handlers

**Owns**: `src/server/ingest/*` (all new), `src/app/api/ingest/route.ts`, `src/app/api/hosts/route.ts`

**Do**:
1. `src/server/ingest/auth.ts` — export `verifyBearer(req: Request): { ok: true; tokenDigest: string } | { ok: false; reason: 'disabled' | 'missing' | 'invalid' }`.
   - Read `process.env.MC_INGEST_TOKENS` on each call, split by comma, trim. (Dev-reload friendly — see Task 1.3.)
   - Memoize: the first call for a given `MC_INGEST_TOKENS` env string SHA-256-hashes each token once into a `Buffer[]` (each digest 32 bytes). Cache keyed by the raw env string so subsequent requests do a lookup, not a hash.
   - Return `disabled` if the list is empty/unset.
   - Return `missing` if no `Authorization` header or missing `Bearer ` prefix.
   - Extract the caller's token, compute `sha256(callerToken)` into a 32-byte Buffer, then `crypto.timingSafeEqual` against each cached digest. Both sides are always 32 bytes — **no padding, no length branching**. Walk the full list regardless of match position to avoid early-exit timing differences.
   - Return the matching digest (hex) as `tokenDigest` so the rate limiter (step 5) can key buckets on the digest without the raw token leaving this module.
   - Stale-bucket GC: the rate limiter's map of `digest → bucket` drops entries idle > 10 min on each `acquire()` call. Enforce here in the acquire path, not as a separate timer (avoids a leak if the process is long-lived).
2. `src/server/ingest/schema.ts` — Zod schemas: `IngestPayloadSchema`, `AgentDeltaSchema`, etc. Strict validation. `hostId` regex `^[a-zA-Z0-9_-]{1,64}$`.
3. `src/server/ingest/hostRegistry.ts` — maintains a `Map<hostId, { hostLabel?: string; lastSeenAt: string }>`. Updated on each successful ingest. Also reflects the local host on boot.
4. `src/server/ingest/ingestHandler.ts` — `applySnapshot(hostId, payload)` and `applyDelta(hostId, payload)`. Both **must** wrap their mutations in `registry.applyBatch(() => { ... })` (Task 1.1 step 5) so a 20-agent payload produces one coalesced SSE flush + one persistence save, not 20 of each. Wraps `registry.upsertAgent` / `removeByHost` / `addEvent`, always stamping `hostId` server-side regardless of what the payload says on each row. Events keep their reporter-supplied `timestamp` but drop any reporter-supplied `seq` (server assigns).
5. `src/server/ingest/rateLimit.ts` — token-bucket per token. `acquire(token): boolean`. Use `INGEST_RATE_BURST` and `INGEST_RATE_REFILL_PER_SEC` from runtime config. In-memory, fine to reset on process restart.
6. `src/app/api/ingest/route.ts` — POST handler wiring everything together. **Do not call `request.json()`** — it drains the whole body uncapped. Stream-read with size limit:
   ```ts
   const reader = request.body?.getReader();
   if (!reader) return errJson(400, 'empty-body');
   const chunks: Uint8Array[] = [];
   let size = 0;
   try {
     for (;;) {
       const { value, done } = await reader.read();
       if (done) break;
       size += value.byteLength;
       if (size > MAX_INGEST_BODY_BYTES) {
         await reader.cancel();
         return errJson(413, 'body-too-large');
       }
       chunks.push(value);
     }
   } finally {
     reader.releaseLock();
   }
   const text = Buffer.concat(chunks.map(Buffer.from)).toString('utf-8');
   let raw: unknown;
   try { raw = JSON.parse(text); } catch { return errJson(400, 'invalid-json'); }
   const parsed = IngestPayloadSchema.safeParse(raw);
   if (!parsed.success) return errJson(400, 'validation', parsed.error.issues);
   ```
   Status codes per Section 3.3. The handler's control flow is: size-guard → JSON parse → Zod validate → auth → rate-limit → `applySnapshot` / `applyDelta` inside a single `registry.applyBatch`.
7. `src/app/api/hosts/route.ts` — GET handler returning the host list per Section 3.4.

**Acceptance**:
- `pnpm tsc --noEmit` clean.
- `pnpm test` green. Integration test (Task 4.1) will verify end-to-end.
- Manual curl against dev server with a valid token should ingest a minimal payload without error; with no token should return 401; with no `MC_INGEST_TOKENS` should return 503.

**Do NOT**:
- Build any UI.
- Modify the existing watcher (types-only changes from Task 1.1 already landed).

---

#### Task 2.2 — frontend-dev — Host UI scaffolding

**Owns**: `src/components/features/HostSelector.tsx`, `src/components/features/HostBadge.tsx`, edits to `src/lib/store/missionStore.ts`

**Do**:
1. Add to `missionStore.ts`: `selectedHostId: string | null` state, `setSelectedHostId` action, and selectors:
   - `selectHosts(state): Host[]` — derived from `state.stats?.hosts ?? []`.
   - `selectFilteredAgents(state): Agent[]` — all agents if `selectedHostId` null, else filtered.
   - `selectFilteredEvents(state): AgentEvent[]` — same filter.
2. Build `HostSelector.tsx`:
   - Reads `hosts` from store.
   - Returns `null` if `hosts.length <= 1`.
   - Button + dropdown. Matches the existing settings button styling in `MissionBar.tsx`.
   - Entries: "All hosts (N)" at top, then each host with freshness dot (colors from Section 3.6).
   - On click, calls `setSelectedHostId`.
   - Close on outside click + Escape (reuse patterns from `TaskDetailDrawer` / `HelpModal`).
3. Build `HostBadge.tsx`:
   - Takes `{ hostId, hostLabel?, compact? }` props.
   - Renders a small pill; styled consistently with phase pills in `AgentStrip.tsx`.
   - Returns `null` if caller passes no hostId.
4. Do **not** yet wire these into `MissionBar.tsx` / `AgentStrip.tsx` — that's Task 4.2, after the ingest path is real.

**Acceptance**:
- `pnpm tsc --noEmit` clean.
- Components exist and render in isolation (can be smoke-tested by dropping them into a Storybook-style harness or just manually in a dev page). No existing pages are changed yet — so no visual regression is possible.

**Do NOT**:
- Modify MissionBar / AgentStrip / AgentPopover yet.

---

### Round 3 — Reporter (serial × 1)

#### Task 3.1 — backend-dev — `scripts/mc-reporter.ts`

**Owns**: `scripts/mc-reporter.ts`, `scripts/mc-reporter.test.ts`

**Do**:
1. Implement per Section 3.5. Zero external runtime deps. Use Node `fetch` + `AbortController` (stable on Node 20+; enforced by `engines.node` in Task 1.3).
2. Import helpers from `../src/server/watcher/watcherCore` using **relative paths only** — do not use `@/...` aliases (`tsx` does not resolve tsconfig paths by default, and adding `tsconfig-paths` would pull a resolver into the reporter runtime). The reporter runs via `pnpm tsx scripts/mc-reporter.ts`; `tsx` was added in Task 1.3. If an import fails, fix `watcherCore.ts` to be registry-free (per Task 1.2 acceptance) — do **not** duplicate parsing code into the reporter.
3. Implement retry + buffer behavior exactly per Section 3.5.
4. On startup, print a one-line banner with `hostId`, `target URL`, `http(s)` — and a warning if URL is `http://` and not `127.0.0.1`/`localhost`.
5. Implement `--help` that prints the env var list + example invocation.
6. Implement `--once` flag: do a single snapshot push then exit. Useful for tests.
7. Add a `scripts/mc-reporter.test.ts` that:
   - Starts a tiny mock HTTP server on a random port.
   - Boots the reporter pointed at the mock with a fake token.
   - Asserts the mock receives exactly one snapshot POST with the right shape.
   - Kills the reporter.
   - Runs as part of `pnpm test`.

**Acceptance**:
- `pnpm tsx scripts/mc-reporter.ts --help` prints usage and exits 0.
- With valid env, reporter boots and stays running; logs a successful first POST to MC's `/api/ingest` within 2 seconds. The first POST **must** be `mode: 'snapshot'` (not `delta`), regardless of `MC_REPORTER_SNAPSHOT_INTERVAL_MS`, so MC receives full state on (re)connect.
- Stopping with Ctrl+C triggers a final `mode: 'snapshot'` flush before exit.
- The test in `mc-reporter.test.ts` passes.

---

### Round 4 — Wiring + UI integration (parallel × 2)

#### Task 4.1 — qa-engineer — Ingest integration tests

**Owns**: `tests/integration/ingest.test.ts`, `tests/unit/hostRegistry.test.ts`, `tests/unit/ingestHandler.test.ts`

**Do**:
1. Integration test covers:
   - 503 when `MC_INGEST_TOKENS` is empty.
   - 401 on missing / wrong / malformed auth.
   - 400 on bad payload shape (wrong hostId regex, missing required fields).
   - 413 on oversize body.
   - 429 after burst exceeded.
   - 200 happy path: snapshot inserts agents; delta upserts; `removedAgentIds` evicts.
   - `hostId` is stamped server-side even if payload tries to claim a different one.
   - Two hosts can coexist: two parallel ingests for `hostA` and `hostB` both land, agents from each are visible via `GET /api/hosts`.
2. Unit tests for `ingestHandler.ts` and `hostRegistry.ts`.

**Acceptance**: `pnpm test` green, new tests pass, total test count increased by ≥ 10.

---

#### Task 4.2 — frontend-dev — Wire HostSelector / HostBadge into the app

**Owns**: `src/components/features/MissionBar.tsx`, `src/components/features/AgentStrip.tsx`, `src/components/features/AgentPopover.tsx`, `src/components/features/AgentPanel.tsx`, `src/lib/config/helpContent.ts`

**Do**:
1. Mount `<HostSelector />` in `MissionBar.tsx` near the help button. It self-hides if `hosts.length <= 1`, so no conditional needed here.
2. In `AgentStrip`, `AgentPopover`, `AgentPanel`: pass through `agent.hostId` / `agent.hostLabel` into a `<HostBadge />` rendered next to the existing phase pill. Badge self-hides when single-host.
3. Replace direct reads of `agents` array with `selectFilteredAgents` wherever the filter should apply (stats counts, kanban, rails). Keep raw `agents` for the HostSelector itself (it must see all hosts).
4. Update `helpContent.ts`:
   - Add a new entry "Hosts" explaining the concept.
   - Update "Agents" and "Subagents" entries to note that counts reflect the current host filter.
   - Update tooltip on the "agents" stat in `MissionBar.tsx` to mention host scoping when multi-host.
5. Confirm no visual regression in single-host mode: boot dev server, verify the top bar looks identical to before when `MC_INGEST_TOKENS` is empty.

**Acceptance**:
- Dev server renders identically to pre-feature when running single-host.
- With `MC_INGEST_TOKENS` set and one reporter running on another "host" (can fake via a second process pushing to `/api/ingest`), the HostSelector appears and filtering works.

**Do NOT**:
- Refactor any unrelated component styling.
- Touch the TaskDetailDrawer, EventsTimeline, or TaskKanban beyond passing filtered data.

---

### Round 5 — Hardening (parallel × 2)

#### Task 5.1 — security-engineer — Security pass

**Do**:
1. Verify `crypto.timingSafeEqual` is used correctly in `auth.ts` (same-length buffers, no early returns).
2. Verify body size limit is enforced **before** parsing (not after), otherwise JSON bomb risk.
3. Confirm Zod strict mode on ingest schemas (`.strict()` to reject unknown keys).
4. Confirm `hostId` regex is applied and rejected payloads don't hit the registry.
5. Confirm reporter warns on `http://` non-loopback target.
6. Check rate limiter doesn't leak memory unbounded — should expire stale buckets after 10 min idle.
7. Audit: can an authenticated reporter impersonate the local host by sending `hostId: "local"`? Yes — document this as a known limitation (v1 uses shared tokens). Add a note in `docs/multi-host-setup.md` recommending unique `hostId` per machine and, for v2, per-token host scoping.

**Deliverable**: a short report (not a file) to the team lead. If any finding is CRITICAL, block ship and delegate the fix to the appropriate agent.

---

#### Task 5.2 — integration-specialist — Docs

**Owns**: `docs/multi-host-setup.md` (new), `README.md`, `src/lib/config/helpContent.ts` (coordination with Task 4.2 — integration-specialist writes the Hosts entry; frontend-dev updates the Agents/Subagents entries)

**Do**:
1. `docs/multi-host-setup.md` sections:
   - What this enables + diagram
   - Prerequisites (reachable MC URL, Node 18+ on each host)
   - Server setup: setting `MC_INGEST_TOKENS`
   - Per-host setup: download/copy `scripts/mc-reporter.mjs` (or clone the repo minimally), set env vars, run
   - Systemd service example
   - Docker example (optional)
   - Troubleshooting: 401/503/429 response meanings, what to check
   - Known limitations / v2 roadmap
2. Update `README.md` with a 3-line blurb under Features ("Multi-host: observe Claude Code on multiple machines via a lightweight reporter") and link to the setup guide.
3. Cross-check all env vars mentioned match Section 5 of this plan.

**Acceptance**: docs build cleanly (no broken markdown), follow the same tone as existing README, all example commands are copy-pasteable.

---

### Round 6 — Final verification (serial × 1)

#### Task 6.1 — qa-engineer — Ship readiness

**Do**:
1. `pnpm install` — confirm clean.
2. `pnpm tsc --noEmit` — zero errors.
3. `pnpm lint` — zero errors.
4. `pnpm test` — all green, count increased by the expected number of new tests.
5. `pnpm build` — Next.js production build passes.
6. Manual smoke:
   - Boot MC with `MC_INGEST_TOKENS=` (empty). Confirm UI has no HostSelector and behaves identically to before.
   - Boot MC with a token, run `scripts/mc-reporter.mjs --once` from a temp dir with a valid WATCH_PROJECT_PATH. Confirm an agent/event from that host appears in the dashboard with the correct hostLabel.
   - Filter by host in the selector — confirm counts update.
7. Grep for any remaining `TODO`, `FIXME`, or `XXX` introduced in this feature. Either fix or move to a follow-up issue.

**Deliverable**: green / yellow / red ship call with a one-line why, to the team lead.

---

## 7. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `tsx` path resolution conflicts with tsconfig aliases | Low | `watcherCore.ts` + reporter use relative imports only; enforced by Task 1.2 acceptance (grep check) |
| Ingest batch fan-out overwhelms SSE stream and persistence file | High if unguarded | `registry.applyBatch()` suspends per-row broadcasts + `scheduleSave`; Task 1.1 step 5 defines the primitive, Task 2.1 step 4 makes `ingestHandler` use it |
| `restartWatcher()` wipes remote-host state on local project switch | Medium | Replace `registry.clear()` with `registry.clearLocal(localHostId())`; Task 1.1 step 9 |
| Ingest becomes a DoS surface | Low (auth-gated) | SHA-256 digest compare (no padding), stream-read body cap enforced before parse, rate limit + stale-bucket GC, strict Zod, ingest disabled by default |
| Snapshot v1→v2 migration corrupts existing state | Low | Keep v1 reader working, write-only v2 — old snapshots continue to hydrate into v2 in memory |
| Team placeholders leak across hosts | Medium | Scope `reconcileTeamPlaceholders` by hostId (Task 1.1 step 8) |
| SSE bandwidth explodes with many hosts | Low in v1 | Existing ring buffer + coalesced stats broadcast already bound this |
| Reporter shared token gets leaked from one host | Medium | Document per-host tokens in v2; warn in docs to use unique tokens per host even in v1 |
| Clock skew between hosts | Medium | Server assigns `seq`; events keep their reporter timestamp for display only |
| CI takes longer due to new tests | Low | Keep ingest tests focused; use in-process Next handler invocation |

---

## 8. Acceptance checklist (for the final summary to the user)

- [ ] All Section 6 rounds complete and green.
- [ ] `MC_INGEST_TOKENS` empty → zero behavioral or visual change vs main.
- [ ] Single remote reporter pushing → second host visible in selector.
- [ ] Two reporters + local → three hosts, filter works, counts scope correctly.
- [ ] `pnpm build` succeeds.
- [ ] `docs/multi-host-setup.md` exists and the example commands work.
- [ ] `.env.example` documents every new var.
- [ ] No `/home/<user>/` leaks introduced.
- [ ] No secrets committed (reporter's token is in the operator's `.env`, not in the repo).

---

## 9. When in doubt

- **Naming conflict with existing code**: prefer the existing name; add a suffix (`Local`, `Ingest`) to the new one.
- **Zod validation surprise**: fail closed — reject the payload, log reason, never crash the process.
- **Test fixture needs hostId**: default to `'local'`.
- **UI change feels bigger than the plan suggests**: stop and re-read Section 3.6 — if the plan genuinely doesn't cover it, choose the smallest change that satisfies the current section and move the larger change to a follow-up.
- **Agent spawned with the wrong subagent_type for the task**: the plan's file ownership table is authoritative. If a task lands in `src/server/ingest/` it's backend-dev, period.

---

## 10. What NOT to do

- Do not add a database. Registry stays in-memory, snapshot to disk.
- Do not add a UI for managing tokens. Env-driven only in v1.
- Do not broadcast the full hosts list over SSE (it's on `MissionStats` already — no new message type needed).
- Do not change how single-host snapshots are saved to disk in `~/.mission-control/state`. Migration is hydrate-time only.
- Do not ship if security-engineer flags a CRITICAL finding.
- Do not commit the reporter's `.env` file. Document its shape in `docs/multi-host-setup.md` only.

---

## 11. Out of scope for v1 (keep as follow-up ideas, don't build now)

- Per-token host binding (a token may only push as one hostId).
- Host groups / tags.
- Historical data backfill on reporter startup.
- Reporter auto-update channel.
- Cross-host task correlation / dependency tracking.
- TLS cert pinning in reporter.
- Prometheus metrics endpoint on MC.
- Dashboard-initiated remote commands (reverse channel).

---

**End of plan.** Last updated: 2026-04-23.
