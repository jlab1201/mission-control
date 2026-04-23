#!/usr/bin/env bash
# Mission Control uninstaller.
#
# Run from inside a Mission Control checkout:
#   ./uninstall.sh              # interactive — asks before each step
#   ./uninstall.sh --clean      # remove node_modules + .next + build artifacts only
#   ./uninstall.sh --full       # everything above + .env + the whole install dir
#   ./uninstall.sh --docker     # also stop docker compose and remove its volumes
#   ./uninstall.sh --yes        # skip confirmations (for scripting)
#   ./uninstall.sh --help       # show help
#
# Never touches global Node/pnpm/corepack — install.sh does not install those
# globally, so uninstall.sh does not remove them. Use nvm/brew/apt directly if
# you want to remove Node itself.

set -euo pipefail

if [ -t 1 ]; then
  C_INFO="\033[0;34m"; C_WARN="\033[0;33m"; C_ERR="\033[0;31m"; C_OK="\033[0;32m"; C_OFF="\033[0m"
else
  C_INFO=""; C_WARN=""; C_ERR=""; C_OK=""; C_OFF=""
fi
info()  { printf "${C_INFO}[MC]${C_OFF} %s\n" "$*"; }
warn()  { printf "${C_WARN}[MC]${C_OFF} %s\n" "$*" >&2; }
die()   { printf "${C_ERR}[MC]${C_OFF} %s\n" "$*" >&2; exit 1; }
ok()    { printf "${C_OK}[MC]${C_OFF} %s\n" "$*"; }

CLEAN=0
FULL=0
DOCKER=0
ASSUME_YES=0

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --clean)  CLEAN=1 ;;
    --full)   FULL=1 ;;
    --docker) DOCKER=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --help|-h) usage ;;
    *) die "Unknown flag: $1 (try --help)" ;;
  esac
  shift
done

# If no mode flag given, go interactive.
INTERACTIVE=0
if [ "$CLEAN" = "0" ] && [ "$FULL" = "0" ] && [ "$DOCKER" = "0" ]; then
  INTERACTIVE=1
fi

# Refuse to run outside a Mission Control checkout.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [ ! -f package.json ] || [ ! -d team-kit ]; then
  die "This doesn't look like a Mission Control checkout (missing package.json or team-kit/). Refusing to run."
fi
if ! grep -q '"name": *"mission-control"' package.json 2>/dev/null; then
  die "package.json doesn't identify this as Mission Control. Refusing to run."
fi

confirm() {
  # confirm "prompt" — returns 0 for yes, 1 for no. Honors --yes.
  local prompt="$1"
  if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  local reply
  printf "${C_WARN}[MC]${C_OFF} %s [y/N] " "$prompt" >&2
  read -r reply </dev/tty || return 1
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

warn_if_port_bound() {
  local port="${1:-10000}"
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    warn "Port $port is currently in use — a Mission Control server may still be running."
    warn "Stop it before uninstalling (Ctrl-C in its terminal, or: kill \$(lsof -tiTCP:$port))."
  fi
}

remove_build_artifacts() {
  local removed=0
  for target in node_modules .next .turbo tsconfig.tsbuildinfo; do
    if [ -e "$target" ]; then
      info "Removing $target"
      rm -rf "$target"
      removed=1
    fi
  done
  if [ "$removed" = "0" ]; then
    info "No build artifacts to remove."
  fi
}

docker_teardown() {
  if ! command -v docker >/dev/null 2>&1; then
    warn "docker CLI not found — skipping Docker teardown."
    return 0
  fi
  local compose_file="docker/docker-compose.yml"
  if [ ! -f "$compose_file" ]; then
    warn "$compose_file not found — skipping Docker teardown."
    return 0
  fi
  info "Stopping Mission Control containers and removing volumes..."
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$compose_file" down -v --remove-orphans || warn "docker compose down returned non-zero."
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$compose_file" down -v --remove-orphans || warn "docker-compose down returned non-zero."
  else
    warn "Neither 'docker compose' nor 'docker-compose' is available — skipping."
  fi
}

remove_env() {
  if [ -f .env ]; then
    warn ".env may contain your customizations (WATCH_PROJECT_PATH, ports, etc.)"
    if confirm "Delete .env?"; then
      rm -f .env
      info "Removed .env"
    else
      info "Kept .env"
    fi
  fi
}

full_uninstall_dir() {
  local target="$SCRIPT_DIR"
  warn "About to DELETE the entire install directory: $target"
  warn "This is irreversible. Make sure you have a backup of anything you want to keep."
  if confirm "Delete $target and everything in it?"; then
    cd "$(dirname "$target")"
    rm -rf "$target"
    ok "Removed $target"
    info "You're now in: $(pwd)"
  else
    die "Aborted."
  fi
}

# ---- Run ----

warn_if_port_bound 10000

if [ "$INTERACTIVE" = "1" ]; then
  info "Interactive uninstall. Pick what to remove."
  if confirm "Remove build artifacts (node_modules, .next, .turbo, tsbuildinfo)?"; then
    remove_build_artifacts
  fi
  if confirm "Stop Docker containers and remove their volumes?"; then
    docker_teardown
  fi
  remove_env
  if confirm "Remove the entire install directory ($SCRIPT_DIR)?"; then
    full_uninstall_dir
  fi
else
  if [ "$CLEAN" = "1" ] || [ "$FULL" = "1" ]; then
    remove_build_artifacts
  fi
  if [ "$DOCKER" = "1" ] || [ "$FULL" = "1" ]; then
    docker_teardown
  fi
  if [ "$FULL" = "1" ]; then
    if [ -f .env ]; then
      if [ "$ASSUME_YES" = "1" ] || confirm "Delete .env (contains your WATCH_PROJECT_PATH etc.)?"; then
        rm -f .env
        info "Removed .env"
      fi
    fi
    full_uninstall_dir
  fi
fi

ok "Uninstall finished."
