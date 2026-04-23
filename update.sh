#!/usr/bin/env bash
# Mission Control updater.
#
# Remote one-liner (auto-detects ./mission-control or current dir):
#   curl -fsSL https://raw.githubusercontent.com/jlab1201/mission-control/main/update.sh | bash
#
# From inside a checkout:
#   ./update.sh
#
# Environment overrides:
#   MC_INSTALL_DIR   Absolute path to the install to update (else auto-detect)
#   MC_BRANCH        Branch to pull (default: current branch)
#   MC_SKIP_BUILD    Set to 1 to skip pnpm build
#   MC_SKIP_RESTART  Set to 1 to skip systemd restart even if the unit exists

set -euo pipefail

if [ -t 1 ]; then
  C_INFO="\033[0;34m"; C_WARN="\033[0;33m"; C_ERR="\033[0;31m"; C_OK="\033[0;32m"; C_OFF="\033[0m"
else
  C_INFO=""; C_WARN=""; C_ERR=""; C_OK=""; C_OFF=""
fi
info() { printf "${C_INFO}[MC]${C_OFF} %s\n" "$*"; }
warn() { printf "${C_WARN}[MC]${C_OFF} %s\n" "$*" >&2; }
die()  { printf "${C_ERR}[MC]${C_OFF} %s\n" "$*" >&2; exit 1; }
ok()   { printf "${C_OK}[MC]${C_OFF} %s\n" "$*"; }

# --- Locate the checkout ---
locate_install() {
  if [ -n "${MC_INSTALL_DIR:-}" ]; then
    [ -d "$MC_INSTALL_DIR" ] || die "MC_INSTALL_DIR=$MC_INSTALL_DIR does not exist."
    echo "$MC_INSTALL_DIR"; return
  fi
  # If run from a file (not piped from curl), BASH_SOURCE is the script itself.
  local script_dir=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if is_mc_checkout "$script_dir"; then echo "$script_dir"; return; fi
  fi
  # Auto-detect: CWD, or CWD/mission-control
  if is_mc_checkout "$PWD"; then echo "$PWD"; return; fi
  if [ -d "$PWD/mission-control" ] && is_mc_checkout "$PWD/mission-control"; then
    echo "$PWD/mission-control"; return
  fi
  die "Could not locate a Mission Control checkout. Run from inside the install dir, or set MC_INSTALL_DIR=/path/to/mission-control."
}

is_mc_checkout() {
  local d="$1"
  [ -f "$d/package.json" ] && [ -d "$d/team-kit" ] && \
    grep -q '"name": *"mission-control"' "$d/package.json" 2>/dev/null
}

INSTALL_DIR="$(locate_install)"
info "Updating Mission Control at: $INSTALL_DIR"
cd "$INSTALL_DIR"

# --- Preflight: git tree must be clean, on a branch that can fast-forward ---
if [ ! -d .git ]; then
  die "$INSTALL_DIR is not a git checkout — cannot update."
fi
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  warn "Uncommitted changes in $INSTALL_DIR:"
  git status --short >&2
  die "Stash or commit local changes before updating (git stash, or git commit)."
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
TARGET_BRANCH="${MC_BRANCH:-$CURRENT_BRANCH}"
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  die "Checkout is in detached-HEAD state. Check out a branch first (e.g. 'git checkout main')."
fi

# --- Pull ---
info "Fetching origin..."
git fetch --quiet origin "$TARGET_BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$TARGET_BRANCH")"
if [ "$LOCAL" = "$REMOTE" ]; then
  ok "Already up to date with origin/$TARGET_BRANCH ($LOCAL)."
  ALREADY_LATEST=1
else
  ALREADY_LATEST=0
  info "Pulling $TARGET_BRANCH: $(git rev-parse --short HEAD) → $(git rev-parse --short "origin/$TARGET_BRANCH")"
  git pull --ff-only origin "$TARGET_BRANCH"
fi

# --- .env drift check ---
if [ -f .env ] && [ -f .env.example ]; then
  NEW_KEYS="$(
    comm -23 \
      <(grep -E '^[A-Z_][A-Z0-9_]*=' .env.example | sed 's/=.*//' | sort -u) \
      <(grep -E '^[A-Z_][A-Z0-9_]*=' .env           | sed 's/=.*//' | sort -u)
  )"
  if [ -n "$NEW_KEYS" ]; then
    warn "New keys are present in .env.example but missing from .env:"
    echo "$NEW_KEYS" | sed 's/^/  - /' >&2
    warn "Add them to .env if you want the new behavior."
  fi
fi

# --- Reinstall deps ---
if ! command -v pnpm >/dev/null 2>&1; then
  die "pnpm not found in PATH. Cannot continue."
fi
info "Installing dependencies..."
pnpm install

# --- Detect how Mission Control is currently running and re-deploy ---
UNIT_FILE="$HOME/.config/systemd/user/mission-control.service"
RESTARTED=0

if [ "${MC_SKIP_RESTART:-0}" != "1" ] && [ -f "$UNIT_FILE" ]; then
  if [ "${MC_SKIP_BUILD:-0}" = "1" ]; then
    info "MC_SKIP_BUILD=1 — skipping pnpm build."
  else
    info "Rebuilding for production..."
    pnpm build
  fi
  info "Restarting systemd user service mission-control..."
  systemctl --user daemon-reload
  systemctl --user restart mission-control.service
  RESTARTED=1
  sleep 1
  systemctl --user --no-pager --lines=0 status mission-control.service || true
fi

if [ "$RESTARTED" = "0" ] && [ "$ALREADY_LATEST" = "0" ]; then
  cat <<EOF

$(ok "Code + dependencies updated.")

No systemd service detected — restart whatever process is running
Mission Control yourself:

  # If you're running pnpm dev:  stop it (Ctrl-C) and run again.
  # If you're running docker:    docker compose -f docker/docker-compose.yml up -d --build
  # If you're running pnpm start: stop it and rerun after 'pnpm build'.

EOF
fi

ok "Update finished."
