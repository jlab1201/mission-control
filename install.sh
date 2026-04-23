#!/usr/bin/env bash
# Mission Control one-line installer.
#
#   curl -fsSL https://raw.githubusercontent.com/jlab1201/mission-control/main/install.sh | bash
#
# Environment overrides:
#   MC_INSTALL_DIR   Directory to clone into (default: ./mission-control)
#   MC_REPO_URL      Git URL to clone (default: public GitHub repo)
#   MC_BRANCH        Branch to check out (default: main)
#   MC_SKIP_SETUP    Set to 1 to skip dependency install and .env copy

set -euo pipefail

REPO_URL="${MC_REPO_URL:-https://github.com/jlab1201/mission-control.git}"
INSTALL_DIR="${MC_INSTALL_DIR:-mission-control}"
BRANCH="${MC_BRANCH:-main}"

if [ -t 1 ]; then
  C_INFO="\033[0;34m"; C_WARN="\033[0;33m"; C_ERR="\033[0;31m"; C_OK="\033[0;32m"; C_OFF="\033[0m"
else
  C_INFO=""; C_WARN=""; C_ERR=""; C_OK=""; C_OFF=""
fi
info()  { printf "${C_INFO}[MC]${C_OFF} %s\n" "$*"; }
warn()  { printf "${C_WARN}[MC]${C_OFF} %s\n" "$*" >&2; }
die()   { printf "${C_ERR}[MC]${C_OFF} %s\n" "$*" >&2; exit 1; }
ok()    { printf "${C_OK}[MC]${C_OFF} %s\n" "$*"; }

command -v git >/dev/null 2>&1 || die "git is required but not installed."

if command -v node >/dev/null 2>&1; then
  node_major=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$node_major" -lt 20 ]; then
    die "Node.js >= 20 required (found $(node -v)). See https://nodejs.org"
  fi
else
  die "Node.js >= 20 required but not installed. See https://nodejs.org"
fi

if [ -e "$INSTALL_DIR" ]; then
  die "'$INSTALL_DIR' already exists. Remove it or set MC_INSTALL_DIR to a different path."
fi

info "Cloning Mission Control ($BRANCH) into $INSTALL_DIR..."
git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ "${MC_SKIP_SETUP:-0}" = "1" ]; then
  info "MC_SKIP_SETUP=1 — skipping dependency install."
else
  info "Running setup..."
  bash scripts/setup.sh
fi

cat <<EOF

$(ok "Install complete.")

Next steps:
  cd $INSTALL_DIR
  \$EDITOR .env                 # set WATCH_PROJECT_PATH to the project you want to observe
  pnpm dev                      # then open http://localhost:3000

Docs:  README.md  |  docs/multi-host-setup.md
EOF
