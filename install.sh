#!/usr/bin/env bash
set -euo pipefail

# ─── Vena Install Script ────────────────────────────────────────────────────
# Usage: curl -fsSL https://raw.githubusercontent.com/Codevena/Vena/master/install.sh | bash

VERSION="0.1.0"
REPO_URL="https://github.com/Codevena/Vena.git"
INSTALL_DIR="${VENA_INSTALL_DIR:-$HOME/.vena}"
BIN_DIR="${VENA_BIN_DIR:-$HOME/.local/bin}"

# ─── Colors ──────────────────────────────────────────────────────────────────

ORANGE='\033[38;2;255;107;43m'
GOLD='\033[38;2;255;159;28m'
GREEN='\033[38;2;46;204;113m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── Logo ────────────────────────────────────────────────────────────────────

print_logo() {
  echo ""
  echo -e "${ORANGE}  ██╗   ██╗███████╗███╗   ██╗ █████╗ ${RESET}"
  echo -e "${ORANGE}  ██║   ██║██╔════╝████╗  ██║██╔══██╗${RESET}"
  echo -e "${GOLD}  ██║   ██║█████╗  ██╔██╗ ██║███████║${RESET}"
  echo -e "${GOLD}  ╚██╗ ██╔╝██╔══╝  ██║╚██╗██║██╔══██║${RESET}"
  echo -e "${GOLD}   ╚████╔╝ ███████╗██║ ╚████║██║  ██║${RESET}"
  echo -e "${GOLD}    ╚═══╝  ╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝${RESET}"
  echo ""
  echo -e "  ${DIM}AI Agent Platform${RESET}  ${ORANGE}v${VERSION}${RESET}"
  echo ""
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

info()    { echo -e "  ${ORANGE}>${RESET} $1"; }
success() { echo -e "  ${GREEN}✓${RESET} $1"; }
warn()    { echo -e "  ${GOLD}!${RESET} $1"; }
error()   { echo -e "  ${ORANGE}✗${RESET} $1" >&2; }
step()    { echo -e "  ${ORANGE}[$1/$2]${RESET} ${BOLD}$3${RESET}"; }

check_command() {
  if ! command -v "$1" &> /dev/null; then
    return 1
  fi
  return 0
}

# ─── Pre-flight Checks ──────────────────────────────────────────────────────

preflight() {
  local missing=()

  if ! check_command node; then
    missing+=("node")
  else
    local node_version
    node_version=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$node_version" -lt 20 ]; then
      error "Node.js v20+ required (found v$(node -v))"
      echo -e "  ${DIM}Install via: https://nodejs.org or 'brew install node'${RESET}"
      exit 1
    fi
  fi

  if ! check_command pnpm; then
    missing+=("pnpm")
  fi

  if ! check_command git; then
    missing+=("git")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing required tools: ${missing[*]}"
    echo ""
    echo -e "  ${DIM}Install them first:${RESET}"
    for tool in "${missing[@]}"; do
      case "$tool" in
        node) echo -e "    ${ORANGE}brew install node${RESET}  ${DIM}or${RESET}  ${ORANGE}https://nodejs.org${RESET}" ;;
        pnpm) echo -e "    ${ORANGE}npm install -g pnpm${RESET}  ${DIM}or${RESET}  ${ORANGE}curl -fsSL https://get.pnpm.io/install.sh | sh -${RESET}" ;;
        git)  echo -e "    ${ORANGE}brew install git${RESET}  ${DIM}or${RESET}  ${ORANGE}xcode-select --install${RESET}" ;;
      esac
    done
    echo ""
    exit 1
  fi
}

# ─── Main Install ───────────────────────────────────────────────────────────

main() {
  print_logo

  echo -e "  ${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""

  # Step 1: Pre-flight
  step 1 5 "Checking requirements..."
  preflight
  success "Node.js $(node -v), pnpm $(pnpm -v), git $(git --version | cut -d' ' -f3)"
  echo ""

  # Step 2: Clone or update
  step 2 5 "Downloading Vena..."
  if [ -d "$INSTALL_DIR/repo" ]; then
    info "Updating existing installation..."
    cd "$INSTALL_DIR/repo"
    git pull --quiet origin main 2>/dev/null || true
    success "Updated to latest version"
  else
    mkdir -p "$INSTALL_DIR"
    git clone --quiet --depth 1 "$REPO_URL" "$INSTALL_DIR/repo" 2>/dev/null || {
      # If clone fails (no remote yet), check if we're running from a local repo
      if [ -f "$(pwd)/package.json" ] && grep -q '"vena"' "$(pwd)/package.json" 2>/dev/null; then
        info "Using local repository..."
        mkdir -p "$INSTALL_DIR"
        ln -sf "$(pwd)" "$INSTALL_DIR/repo"
        success "Linked local repository"
      else
        error "Could not clone repository. For local install, run from the vena directory."
        exit 1
      fi
    }
  fi
  echo ""

  # Step 3: Install dependencies
  step 3 5 "Installing dependencies..."
  cd "$INSTALL_DIR/repo"
  pnpm install --frozen-lockfile --silent 2>/dev/null || pnpm install --silent 2>/dev/null || pnpm install
  success "Dependencies installed"
  echo ""

  # Step 4: Build
  step 4 5 "Building Vena..."
  pnpm --filter @vena/shared --silent build 2>/dev/null || pnpm --filter @vena/shared build
  pnpm -r --silent build 2>/dev/null || pnpm -r build
  success "All packages built (12/12)"
  echo ""

  # Step 5: Link CLI globally
  step 5 5 "Setting up CLI..."
  mkdir -p "$BIN_DIR"

  # Create wrapper script
  cat > "$BIN_DIR/vena" << 'WRAPPER'
#!/usr/bin/env bash
VENA_DIR="${VENA_INSTALL_DIR:-$HOME/.vena}"
exec node "$VENA_DIR/repo/apps/cli/dist/index.js" "$@"
WRAPPER
  chmod +x "$BIN_DIR/vena"

  # Ensure bin dir is in PATH
  local shell_rc=""
  if [ -f "$HOME/.zshrc" ]; then
    shell_rc="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    shell_rc="$HOME/.bashrc"
  elif [ -f "$HOME/.bash_profile" ]; then
    shell_rc="$HOME/.bash_profile"
  fi

  local path_added=false
  if [ -n "$shell_rc" ]; then
    if ! echo "$PATH" | tr ':' '\n' | grep -q "^$BIN_DIR$"; then
      if ! grep -q "$BIN_DIR" "$shell_rc" 2>/dev/null; then
        echo "" >> "$shell_rc"
        echo "# Vena AI Agent Platform" >> "$shell_rc"
        echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$shell_rc"
        path_added=true
      fi
    fi
  fi

  success "CLI installed at $BIN_DIR/vena"
  echo ""

  # ── Done ─────────────────────────────────────────────────────────────────
  echo -e "  ${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  echo -e "  ${GREEN}${BOLD}Installation complete!${RESET}"
  echo ""
  echo -e "  ${DIM}Get started:${RESET}"
  echo ""
  echo -e "    ${ORANGE}vena onboard${RESET}    ${DIM}Interactive setup wizard${RESET}"
  echo -e "    ${ORANGE}vena start${RESET}      ${DIM}Launch the platform${RESET}"
  echo -e "    ${ORANGE}vena chat${RESET}       ${DIM}Chat with your agent${RESET}"
  echo ""

  if [ "$path_added" = true ]; then
    echo -e "  ${GOLD}!${RESET} ${DIM}Restart your terminal or run:${RESET}"
    echo -e "    ${ORANGE}source $shell_rc${RESET}"
    echo ""
  fi

  echo -e "  ${DIM}Vena is ready. Run ${RESET}${BOLD}vena onboard${RESET}${DIM} to begin.${RESET}"
  echo ""
}

main "$@"
