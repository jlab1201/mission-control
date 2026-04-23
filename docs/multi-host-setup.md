# Multi-Host Setup

Connect multiple machines to a single Mission Control dashboard so you can see Claude Code activity across your laptop, desktop, remote servers, and CI runners in one place.

---

## What this enables

Each machine runs a lightweight reporter script (`mc-reporter.mjs`) that reads local Claude Code JSONL transcripts and pushes parsed events to your central MC server over HTTPS. The dashboard gains a host selector so you can view all activity together or filter to a single machine.

```
  [Laptop]                [Desktop]               [Remote VM]
  Claude Code             Claude Code              Claude Code
      |                       |                        |
  mc-reporter             mc-reporter             mc-reporter
      |  HTTPS POST            |  HTTPS POST             |  HTTPS POST
      +------------+-----------+                         |
                   |           +---------+---------------+
                   v                     v
              [MC server]  <----  /api/ingest
                   |
                 browser
```

The reporter is push-only — it never opens inbound ports. Firewalls and NAT are not an obstacle as long as the reporter can reach the MC URL.

---

## Prerequisites

- **Node 20 or later** installed on each machine you want to observe (the reporter uses `fetch` and `ReadableStream`, which require Node 20+).
- The MC server is **reachable** from each reporter machine (HTTP or HTTPS). For anything beyond localhost, put a TLS-terminating reverse proxy (nginx, Caddy, Cloudflare Tunnel) in front of MC — MC itself does not terminate TLS.
- A **shared bearer token** (or multiple tokens, one per machine). Tokens are arbitrary hex strings; the instructions below show how to generate them.

---

## Server setup (MC side)

### 1. Generate a token

Run this on the MC machine (or any machine with OpenSSL):

```bash
openssl rand -hex 32
```

Generate one token per reporter machine if you want to be able to revoke them independently. Tokens are separated by commas in the env var.

### 2. Add the token(s) to MC's environment

In MC's `.env` file, add or update:

```bash
# Comma-separated bearer tokens accepted at /api/ingest.
# Leave empty (or unset) to disable remote ingest entirely.
MC_INGEST_TOKENS=<token1>,<token2>
```

You can also set a friendly name for MC's own host:

```bash
MC_HOST_ID=my-server       # Short ID shown in the host selector (default: local)
MC_HOST_LABEL="My Server"  # Optional display name
```

### 3. Restart MC

```bash
pnpm dev   # development
# or
docker compose restart   # production Docker
```

### 4. Verify the endpoint is live

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -X POST <mc-url>/api/ingest \
  -d '{"hostId":"test","mode":"snapshot","payload":{}}'
```

Expected: `200`. Other responses:

| Code | Meaning |
|------|---------|
| `200` | Ingest accepted |
| `401` | Token missing or wrong |
| `503` | `MC_INGEST_TOKENS` is empty — ingest disabled |
| `429` | Rate limit exceeded |
| `413` | Payload exceeds the 5 MB body cap |
| `400` | Malformed JSON or failed validation |

---

## Per-host setup (each machine you want to observe)

### Option A — Download from MC (recommended)

MC serves the reporter as a pre-bundled, dependency-free file. You only need Node 20+.

```bash
# Download
curl -fSLO <mc-url>/mc-reporter.mjs

# Run (set env vars first — see below)
MC_REPORTER_TARGET_URL=<mc-url> \
MC_REPORTER_TOKEN=<token> \
MC_REPORTER_HOST_ID=laptop \
node mc-reporter.mjs
```

The dashboard also exposes a "Connect a host" modal (visible in the top bar when `MC_INGEST_TOKENS` is set) with pre-filled copy-paste commands based on your MC's current origin.

### Option B — Run from source (development / contributors)

```bash
git clone <repo-url> mission-control
cd mission-control
pnpm install
pnpm tsx scripts/mc-reporter.ts
```

### Required environment variables

| Variable | Description |
|----------|-------------|
| `MC_REPORTER_TARGET_URL` | Full URL to your MC server, e.g. `https://mc.example.com` |
| `MC_REPORTER_TOKEN` | Must match one entry in `MC_INGEST_TOKENS` on the server |
| `MC_REPORTER_HOST_ID` | Short, stable identifier for this machine. Allowed characters: `a-z A-Z 0-9 _ -`, max 64 chars. Example: `laptop`, `prod-vm-1` |

### Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MC_REPORTER_HOST_LABEL` | _(none)_ | Human-friendly display name shown in the host selector, e.g. `"My Laptop"` |
| `WATCH_PROJECT_PATH` | _(launch directory)_ | Absolute path to the Claude Code project to observe. Defaults to the current working directory, same as MC. |
| `MC_REPORTER_BATCH_INTERVAL_MS` | `1000` | How often (ms) incremental deltas are sent |
| `MC_REPORTER_SNAPSHOT_INTERVAL_MS` | `30000` | How often (ms) a full state snapshot is sent |
| `MC_REPORTER_HTTP_TIMEOUT_MS` | `10000` | Per-request HTTP timeout (ms) |

---

## Systemd service example

Save as `/etc/systemd/system/mc-reporter.service`, then run `sudo systemctl enable --now mc-reporter`.

```ini
[Unit]
Description=Mission Control Reporter
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/mc-reporter
ExecStart=/usr/bin/node /home/youruser/mc-reporter/mc-reporter.mjs
Restart=on-failure
RestartSec=5

Environment=MC_REPORTER_TARGET_URL=https://mc.example.com
Environment=MC_REPORTER_TOKEN=<token>
Environment=MC_REPORTER_HOST_ID=my-server
Environment=MC_REPORTER_HOST_LABEL=My Server
Environment=WATCH_PROJECT_PATH=/home/youruser/myproject

# Optional tuning
Environment=MC_REPORTER_BATCH_INTERVAL_MS=1000
Environment=MC_REPORTER_SNAPSHOT_INTERVAL_MS=30000

StandardOutput=journal
StandardError=journal
SyslogIdentifier=mc-reporter

[Install]
WantedBy=multi-user.target
```

---

## Docker example

If you prefer to run the reporter in a container alongside your Claude Code workload:

```dockerfile
FROM node:20-slim

WORKDIR /app

# Download the reporter from your MC instance at build time,
# or COPY mc-reporter.mjs . if you have it locally.
ARG MC_URL
RUN curl -fSLO ${MC_URL}/mc-reporter.mjs

CMD ["node", "mc-reporter.mjs"]
```

```bash
docker build --build-arg MC_URL=https://mc.example.com -t mc-reporter .

docker run -d \
  -e MC_REPORTER_TARGET_URL=https://mc.example.com \
  -e MC_REPORTER_TOKEN=<token> \
  -e MC_REPORTER_HOST_ID=docker-host \
  -e WATCH_PROJECT_PATH=/project \
  -v /path/to/project:/project:ro \
  mc-reporter
```

---

## Troubleshooting

### Reading reporter log lines

The reporter writes structured log lines to stderr:

```
[mc-reporter] 2026-04-23T10:00:00.000Z INFO  connected host=laptop target=https://mc.example.com
[mc-reporter] 2026-04-23T10:00:01.000Z INFO  snapshot sent agents=3 events=12
[mc-reporter] 2026-04-23T10:00:05.000Z WARN  POST failed status=401 retrying in 1s
```

### Common errors

**401 Unauthorized**
- The token in `MC_REPORTER_TOKEN` does not match any entry in `MC_INGEST_TOKENS` on the server.
- Check for trailing spaces or newlines in the token value.
- Remember that `MC_INGEST_TOKENS` accepts a comma-separated list — ensure the correct token is present.

**503 Service Unavailable — `ingest-disabled`**
- `MC_INGEST_TOKENS` is empty or unset on the server. Add at least one token and restart MC.

**429 Too Many Requests**
- The reporter is sending faster than the server's rate limit allows (default: 100 requests per 10 s burst, refilling at 10/s).
- Increase `MC_REPORTER_BATCH_INTERVAL_MS` on the reporter, or raise `MC_INGEST_RATE_BURST` / `MC_INGEST_RATE_REFILL_PER_SEC` on the server.

**413 Request Entity Too Large**
- A single ingest payload exceeded 5 MB. This is unusual in normal use but can happen if a very large number of events accumulate while the reporter is offline.
- The reporter will automatically drop oldest buffered events (buffer cap: 500 events) to prevent this. If you hit it repeatedly, lower `MC_REPORTER_SNAPSHOT_INTERVAL_MS` so snapshots stay smaller.

**400 Bad Request**
- The payload failed schema validation. Check that `MC_REPORTER_HOST_ID` matches the pattern `^[a-zA-Z0-9_-]{1,64}$` (no spaces, no special characters beyond `_` and `-`).

**Connection refused / ENOTFOUND**
- The reporter cannot reach MC. Check `MC_REPORTER_TARGET_URL` for typos.
- Verify the MC server is running and the port is accessible from the reporter machine (firewall rules, VPN, etc.).
- The reporter will retry with exponential backoff (1 s → 30 s cap) and continue indefinitely — it will reconnect automatically once reachability is restored.

**Reporter started but no host appears in the dashboard**
- The first POST from the reporter is always a `mode: snapshot`. Wait up to `MC_REPORTER_BATCH_INTERVAL_MS` (default 1 s) after the reporter logs a successful send.
- Verify the host selector appears in MC's top bar. It only shows when more than one host is present. If MC's own host is the only one, the selector is hidden.

---

## Known limitations (v1)

**Shared token list — no per-token host isolation.**
Any holder of a valid token can POST as any `hostId`, including the MC server's own host ID. For stronger isolation, use a unique token per machine and a distinct `MC_REPORTER_HOST_ID` per machine. Per-token host binding is planned for v2.

**No TLS termination in MC.**
MC trusts whatever is in front of it. For production use, put nginx, Caddy, or Cloudflare Tunnel in front of MC and point reporters at the HTTPS URL. The reporter will log a warning if `MC_REPORTER_TARGET_URL` is `http://` and is not pointing at `127.0.0.1` or `localhost`.

**No historical backfill.**
The reporter only forwards events from startup onward, plus one initial snapshot of the current state. If a reporter was offline during a long Claude Code session, those earlier events will not appear in the dashboard.

**No dashboard-initiated commands.**
The reporter is push-only. MC cannot send commands or requests back to reporter machines. Remote triggering of agents or file reads is out of scope for v1.
