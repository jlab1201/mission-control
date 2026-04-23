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

print_install_hint() {
  # Print OS-specific copy-paste install commands for a missing dependency.
  # $1 = dependency name (e.g. "Node.js 20", "git")
  # $2 = which manager hint ("node" or "git")
  local dep="$1" kind="$2" os="" distro=""
  os="$(uname -s 2>/dev/null || echo unknown)"
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    distro="$(. /etc/os-release && echo "${ID:-}")"
  fi

  warn ""
  warn "To install ${dep}:"
  case "$kind" in
    node)
      case "$os" in
        Darwin)
          warn "  # macOS (Homebrew):"
          warn "  brew install node@20 && brew link --overwrite --force node@20"
          ;;
        Linux)
          warn "  # Recommended — nvm (no sudo, works on any distro):"
          warn "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
          warn "  export NVM_DIR=\"\$HOME/.nvm\" && . \"\$NVM_DIR/nvm.sh\""
          warn "  nvm install 20 && nvm use 20"
          case "$distro" in
            ubuntu|debian)
              warn ""
              warn "  # Or system-wide via NodeSource (requires sudo):"
              warn "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
              warn "  sudo apt-get install -y nodejs"
              ;;
            rhel|centos|fedora|rocky|almalinux)
              warn ""
              warn "  # Or system-wide via NodeSource (requires sudo):"
              warn "  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -"
              warn "  sudo dnf install -y nodejs"
              ;;
          esac
          ;;
        *)
          warn "  See https://nodejs.org (Node.js 20 LTS)"
          ;;
      esac
      ;;
    git)
      case "$os" in
        Darwin)  warn "  brew install git   # or: xcode-select --install" ;;
        Linux)
          case "$distro" in
            ubuntu|debian)                         warn "  sudo apt-get update && sudo apt-get install -y git" ;;
            rhel|centos|fedora|rocky|almalinux)    warn "  sudo dnf install -y git" ;;
            arch)                                  warn "  sudo pacman -S --noconfirm git" ;;
            alpine)                                warn "  sudo apk add git" ;;
            *)                                     warn "  Install 'git' from your distro's package manager." ;;
          esac
          ;;
        *) warn "  See https://git-scm.com/downloads" ;;
      esac
      ;;
  esac
  warn ""
  warn "Then re-run this installer."
}

if ! command -v git >/dev/null 2>&1; then
  print_install_hint "git" "git"
  die "git is required but not installed."
fi

if command -v node >/dev/null 2>&1; then
  node_major=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$node_major" -lt 20 ]; then
    print_install_hint "Node.js 20" "node"
    die "Node.js >= 20 required (found $(node -v))."
  fi
else
  print_install_hint "Node.js 20" "node"
  die "Node.js >= 20 required but not installed."
fi

if ! command -v pnpm >/dev/null 2>&1 && ! command -v corepack >/dev/null 2>&1; then
  warn ""
  warn "Neither pnpm nor corepack was found. Mission Control uses pnpm."
  warn "Corepack ships with Node.js 16.10+, so reinstalling Node (see above) is"
  warn "the simplest fix. Or install pnpm directly:"
  warn "  npm install -g pnpm"
  warn ""
  die "pnpm (or corepack) is required but not installed."
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
