#!/usr/bin/env bash
set -euo pipefail

# ─── Vena Local Development Setup ───────────────────────────────────────────
# Run this from the vena repo root to build and link the CLI locally.
# Usage: ./setup.sh

ORANGE='\033[38;2;255;107;43m'
GREEN='\033[38;2;46;204;113m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${ORANGE}${BOLD}  Vena Local Setup${RESET}"
echo ""

# Check we're in the right directory
if [ ! -f "package.json" ] || ! grep -q '"@vena/root"' package.json 2>/dev/null; then
  if [ ! -f "package.json" ] || ! grep -q '"vena"' package.json 2>/dev/null; then
    echo -e "  ${ORANGE}!${RESET} Run this script from the vena repo root."
    exit 1
  fi
fi

echo -e "  ${ORANGE}1.${RESET} Installing dependencies..."
pnpm install

echo ""
echo -e "  ${ORANGE}2.${RESET} Building all packages..."
pnpm --filter @vena/shared build
pnpm -r build

echo ""
echo -e "  ${ORANGE}3.${RESET} Linking CLI..."

# Create local bin wrapper
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

REPO_DIR="$(pwd)"
cat > "$BIN_DIR/vena" << WRAPPER
#!/usr/bin/env bash
exec node "$REPO_DIR/apps/cli/dist/index.js" "\$@"
WRAPPER
chmod +x "$BIN_DIR/vena"

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -q "^$BIN_DIR$"; then
  SHELL_RC=""
  if [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bashrc"
  fi

  if [ -n "$SHELL_RC" ] && ! grep -q "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# Vena AI Agent Platform" >> "$SHELL_RC"
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
    echo -e "  ${DIM}Added $BIN_DIR to PATH in $SHELL_RC${RESET}"
  fi
fi

echo ""
echo -e "  ${GREEN}${BOLD}Done!${RESET}"
echo ""
echo -e "  ${DIM}Commands:${RESET}"
echo -e "    ${ORANGE}vena${RESET}            ${DIM}Auto-launch onboarding (first run)${RESET}"
echo -e "    ${ORANGE}vena onboard${RESET}    ${DIM}Interactive setup wizard${RESET}"
echo -e "    ${ORANGE}vena start${RESET}      ${DIM}Launch the platform${RESET}"
echo -e "    ${ORANGE}vena chat${RESET}       ${DIM}Chat with your agent${RESET}"
echo ""
echo -e "  ${DIM}If 'vena' is not found, run:${RESET} ${ORANGE}source ~/.zshrc${RESET}"
echo ""
