#!/usr/bin/env bash
#
# install.sh — Bun installer for likha
#
# Installs Bun (if missing), installs dependencies (root + ui), builds the
# project, and links the CLI binaries (likha, xcoder) globally.
#
# Usage:
#   ./install.sh            # install deps, build, and link globally
#   ./install.sh --no-link  # install deps and build only, skip global link
#   ./install.sh --no-ui    # skip the ui/ subproject install+build
#   ./install.sh --dev      # install deps only, skip build/link (for `bun run dev`)

set -euo pipefail

# ---- helpers ---------------------------------------------------------------

info()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn()  { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
error() { printf '\033[1;31mxx\033[0m %s\n' "$1" >&2; }

LINK=1
DEV_ONLY=0
WITH_UI=1

for arg in "$@"; do
  case "$arg" in
    --no-link) LINK=0 ;;
    --no-ui) WITH_UI=0 ;;
    --dev) DEV_ONLY=1; LINK=0 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      warn "Unknown option: $arg"
      ;;
  esac
done

# ---- 1. ensure Bun is installed --------------------------------------------

if ! command -v bun >/dev/null 2>&1; then
  info "Bun not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | bash

  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun >/dev/null 2>&1; then
    error "Bun installation finished but 'bun' is still not on PATH."
    error "Open a new shell (or 'source ~/.bashrc'/'~/.zshrc') and re-run this script."
    exit 1
  fi
else
  info "Bun found: $(bun --version)"
fi

# ---- 2. sanity checks -------------------------------------------------------

if [ ! -f package.json ]; then
  error "package.json not found. Run this script from the likha project root."
  exit 1
fi

NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  warn "Detected Node major version: ${NODE_MAJOR:-none}. This project's devDependencies target Node 20 types."
fi

HAS_UI=0
if [ -d ui ] && [ "$WITH_UI" -eq 1 ]; then
  HAS_UI=1
fi

# ---- 3. install dependencies with Bun --------------------------------------

info "Installing root dependencies with Bun..."
bun install

if [ -d node_modules/playwright ]; then
  warn "Playwright detected — you may need browser binaries: bun run playwright install"
fi

if [ "$HAS_UI" -eq 1 ]; then
  info "Installing ui/ dependencies with Bun..."
  (cd ui && bun install)
elif [ -d ui ] && [ "$WITH_UI" -eq 0 ]; then
  info "Skipping ui/ dependency install (--no-ui)."
fi

if [ "$DEV_ONLY" -eq 1 ]; then
  info "Dependencies installed. Skipping build/link (--dev)."
  info "Run the CLI in dev mode with: bun run dev"
  exit 0
fi

# ---- 4. build ---------------------------------------------------------------

info "Building core (bun run build)..."
bun run build

if [ "$HAS_UI" -eq 1 ]; then
  info "Building ui/ (bun run build)..."
  (cd ui && bun run build)
fi

if [ ! -d dist ]; then
  error "Build finished but 'dist' directory was not created. Check the build output above."
  exit 1
fi

# ---- 5. link binaries globally ---------------------------------------------

if [ "$LINK" -eq 1 ]; then
  info "Linking CLI binaries globally with Bun (likha, xcoder)..."
  bun link

  info "Verifying bin entries..."
  for bin in likha xcoder; do
    if command -v "$bin" >/dev/null 2>&1; then
      info "  ✓ $bin -> $(command -v "$bin")"
    else
      warn "  ✗ $bin not found on PATH after linking."
      warn "    Make sure Bun's global bin dir is on your PATH, e.g.:"
      warn "    export PATH=\"\$HOME/.bun/bin:\$PATH\""
    fi
  done
else
  info "Skipping global link (--no-link). Run locally with: node dist/cli/index.js"
fi

info "Done. Try: likha --help"
