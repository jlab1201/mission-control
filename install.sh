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
#   MC_AUTOSTART     Controls post-install behavior. Values:
#                      auto     (default) install & start a systemd --user
#                               service on Linux when systemd is available;
#                               otherwise print manual "Next steps"
#                      systemd  force systemd; fail if not available
#                      none     never autostart — always print "Next steps"

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

# Plain stderr line, no [MC] prefix — used for copy-pasteable instruction blocks.
hint() { printf "%s\n" "$*" >&2; }

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

  hint ""
  hint "To install ${dep}:"
  case "$kind" in
    node)
      case "$os" in
        Darwin)
          hint "  # macOS (Homebrew):"
          hint "  brew install node@20 && brew link --overwrite --force node@20"
          ;;
        Linux)
          hint "  # Recommended — nvm (no sudo, works on any distro):"
          hint "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
          hint "  export NVM_DIR=\"\$HOME/.nvm\" && . \"\$NVM_DIR/nvm.sh\""
          hint "  nvm install 20 && nvm use 20"
          case "$distro" in
            ubuntu|debian)
              hint ""
              hint "  # Or system-wide via NodeSource (requires sudo):"
              hint "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
              hint "  sudo apt-get install -y nodejs"
              ;;
            rhel|centos|fedora|rocky|almalinux)
              hint ""
              hint "  # Or system-wide via NodeSource (requires sudo):"
              hint "  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -"
              hint "  sudo dnf install -y nodejs"
              ;;
          esac
          ;;
        *)
          hint "  See https://nodejs.org (Node.js 20 LTS)"
          ;;
      esac
      ;;
    git)
      case "$os" in
        Darwin)  hint "  brew install git   # or: xcode-select --install" ;;
        Linux)
          case "$distro" in
            ubuntu|debian)                         hint "  sudo apt-get update && sudo apt-get install -y git" ;;
            rhel|centos|fedora|rocky|almalinux)    hint "  sudo dnf install -y git" ;;
            arch)                                  hint "  sudo pacman -S --noconfirm git" ;;
            alpine)                                hint "  sudo apk add git" ;;
            *)                                     hint "  Install 'git' from your distro's package manager." ;;
          esac
          ;;
        *) hint "  See https://git-scm.com/downloads" ;;
      esac
      ;;
  esac
  hint ""
  hint "Then re-run this installer."
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
  hint ""
  hint "Neither pnpm nor corepack was found. Mission Control uses pnpm."
  hint "Corepack ships with Node.js 16.10+, so reinstalling Node (see above) is"
  hint "the simplest fix. Or install pnpm directly:"
  hint "  npm install -g pnpm"
  hint ""
  die "pnpm (or corepack) is required but not installed."
fi

if [ -e "$INSTALL_DIR" ]; then
  if [ -f "$INSTALL_DIR/package.json" ] && [ -d "$INSTALL_DIR/team-kit" ] && \
     grep -q '"name": *"mission-control"' "$INSTALL_DIR/package.json" 2>/dev/null; then
    hint ""
    hint "An existing Mission Control install was found at: $INSTALL_DIR"
    hint "To update it, run:"
    hint "  cd $INSTALL_DIR && ./update.sh"
    hint "Or from anywhere:"
    hint "  curl -fsSL https://raw.githubusercontent.com/jlab1201/mission-control/main/update.sh | bash"
    hint ""
    die "'$INSTALL_DIR' already exists — use update.sh to update, or set MC_INSTALL_DIR to a different path."
  fi
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

# Prints a one-line reason and returns non-zero if systemd --user is unusable.
# No side effects beyond the echo. Safe to call from `auto` mode.
probe_systemd() {
  if [ "$(uname -s)" != "Linux" ]; then
    echo "host is $(uname -s), not Linux"; return 1
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found"; return 1
  fi
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "no user systemd session (not logged in via logind, or running in a bare container)"
    return 1
  fi
  return 0
}

install_systemd_unit() {
  # $1 = absolute install dir
  local install_dir="$1" reason=""
  if ! reason="$(probe_systemd)"; then
    die "systemd --user is not usable here: $reason"
  fi

  local pnpm_bin node_bin
  pnpm_bin="$(command -v pnpm || true)"
  node_bin="$(command -v node || true)"
  if [ -z "$pnpm_bin" ] || [ -z "$node_bin" ]; then
    die "Cannot resolve absolute path for pnpm or node — aborting systemd setup."
  fi
  local path_dirs
  path_dirs="$(dirname "$node_bin"):$(dirname "$pnpm_bin"):/usr/local/bin:/usr/bin:/bin"

  info "Building Mission Control for production..."
  pnpm build

  local unit_dir="$HOME/.config/systemd/user"
  local unit_file="$unit_dir/mission-control.service"
  mkdir -p "$unit_dir"

  info "Writing systemd user unit: $unit_file"
  cat > "$unit_file" <<UNIT
[Unit]
Description=Mission Control Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=$install_dir
EnvironmentFile=-$install_dir/.env
Environment=PATH=$path_dirs
Environment=NODE_ENV=production
ExecStart=$pnpm_bin start
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
UNIT

  info "Reloading user systemd and enabling mission-control.service..."
  systemctl --user daemon-reload
  systemctl --user enable --now mission-control.service

  # Check lingering so it survives reboot / logout.
  local linger="no"
  if command -v loginctl >/dev/null 2>&1; then
    linger="$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)"
  fi

  ok "mission-control.service started."
  echo
  echo "Status:        systemctl --user status mission-control"
  echo "Logs:          journalctl --user -u mission-control -f"
  echo "Restart:       systemctl --user restart mission-control"
  echo "Stop:          systemctl --user stop mission-control"
  echo "Disable:       systemctl --user disable --now mission-control"
  echo
  if [ "$linger" != "yes" ]; then
    warn "Lingering is NOT enabled for '$USER' — the service will stop when you log out."
    hint "To keep it running across logout/reboot, run once (needs sudo):"
    hint "  sudo loginctl enable-linger $USER"
    hint ""
  fi
}

print_next_steps() {
  cat <<EOF

$(ok "Install complete.")

Next steps:
  cd $INSTALL_DIR
  \$EDITOR .env                 # set WATCH_PROJECT_PATH to the project you want to observe

  # Local development (hot-reload, unoptimized):
  pnpm dev                      # http://localhost:10000

  # Production (optimized build):
  pnpm build
  pnpm start                    # http://localhost:10000

  # Or re-run the installer with MC_AUTOSTART=systemd on a Linux host to
  # install & start as a systemd --user service.

Port is controlled by PORT in .env (default 10000).

Docs:  README.md  |  docs/multi-host-setup.md
EOF
}

run_systemd_install() {
  install_systemd_unit "$(pwd)"
  ok "Install complete. Mission Control is running on http://localhost:10000"
  info "Edit $(pwd)/.env and then: systemctl --user restart mission-control"
}

AUTOSTART="${MC_AUTOSTART:-auto}"
case "$AUTOSTART" in
  none|0|no|false)
    print_next_steps
    ;;
  auto)
    reason=""
    if reason="$(probe_systemd)"; then
      info "Autostart: systemd --user is available — installing as a background service."
      run_systemd_install
    else
      info "Autostart skipped ($reason) — falling back to manual start."
      print_next_steps
    fi
    ;;
  systemd)
    run_systemd_install
    ;;
  *)
    die "Unknown MC_AUTOSTART value: '$AUTOSTART'. Supported: auto (default), systemd, none."
    ;;
esac
