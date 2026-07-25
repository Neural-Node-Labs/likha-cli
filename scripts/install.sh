#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# install.sh — Install the devnull packaged artifact
#
# Installs the compiled devnull artifact into a target directory, sets up the
# runtime environment (directories, permissions, config), and validates the
# installation. Designed to be idempotent — safe to re-run.
#
# Usage:
#   ./scripts/install.sh                    # Install to default prefix (/opt/devnull)
#   ./scripts/install.sh --prefix /usr/local  # Install to custom prefix
#   ./scripts/install.sh --from-tarball       # Install from devnull-deploy.tar.gz
#   ./scripts/install.sh --help               # Show help
#
# Environment:
#   DEVNULL_HOME    — Installation prefix (default: /opt/devnull)
#   DEVNULL_USER    — Runtime user (default: devnull)
#   DEVNULL_GROUP   — Runtime group (default: devnull)
#   NODE_ENV        — Runtime environment (default: production)
#
# Idempotency:
#   - Directories are created with mkdir -p (no-op if exists)
#   - Files are copied with cp -n (no-clobber) for config templates
#   - npm install --omit=dev is safe to re-run
#   - User/group creation uses -f/--system flags (no-op if exists)
#   - Symlinks are created with -f (force, safe to re-run)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration (with defaults) ───────────────────────────────────────────
DEVNULL_HOME="${DEVNULL_HOME:-/opt/devnull}"
DEVNULL_USER="${DEVNULL_USER:-devnull}"
DEVNULL_GROUP="${DEVNULL_GROUP:-devnull}"
NODE_ENV="${NODE_ENV:-production}"
INSTALL_FROM_TARBALL=false
TARBALL_PATH=""

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ─── Help ────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Install the devnull packaged artifact.

Options:
  --prefix DIR       Installation prefix (default: /opt/devnull)
  --from-tarball     Install from devnull-deploy.tar.gz (reads from PROJECT_DIR)
  --tarball PATH     Install from a specific tarball path
  --help             Show this help message

Environment variables:
  DEVNULL_HOME       Installation prefix (overrides --prefix)
  DEVNULL_USER       Runtime user (default: devnull)
  DEVNULL_GROUP      Runtime group (default: devnull)
  NODE_ENV           Runtime environment (default: production)

Idempotent: safe to re-run at any time.
EOF
  exit 0
}

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      DEVNULL_HOME="$2"
      shift 2
      ;;
    --from-tarball)
      INSTALL_FROM_TARBALL=true
      TARBALL_PATH="${PROJECT_DIR}/devnull-deploy.tar.gz"
      shift
      ;;
    --tarball)
      INSTALL_FROM_TARBALL=true
      TARBALL_PATH="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      ;;
    *)
      error "Unknown option: $1"
      echo "Usage: $(basename "$0") [--prefix DIR] [--from-tarball] [--help]"
      exit 1
      ;;
  esac
done

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  devnull Installation Script"
  echo "  Target:  ${DEVNULL_HOME}"
  echo "  User:    ${DEVNULL_USER}:${DEVNULL_GROUP}"
  echo "  Mode:    $([ "$INSTALL_FROM_TARBALL" = true ] && echo "from tarball" || echo "from source")"
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""

  # ── Step 1: Verify source ──────────────────────────────────────────────────
  info "Step 1/8: Verifying source..."

  if [ "$INSTALL_FROM_TARBALL" = true ]; then
    if [ ! -f "$TARBALL_PATH" ]; then
      error "Tarball not found: $TARBALL_PATH"
      error "Run 'npm run package:tarball' first, or specify a different path."
      exit 1
    fi
    success "Tarball found: $TARBALL_PATH ($(du -h "$TARBALL_PATH" | cut -f1))"
  else
    if [ ! -d "${PROJECT_DIR}/dist" ]; then
      error "dist/ directory not found at ${PROJECT_DIR}/dist"
      error "Run 'npm run build' first, or use --from-tarball."
      exit 1
    fi
    if [ ! -f "${PROJECT_DIR}/dist/cli/index.js" ]; then
      error "CLI entry point not found: ${PROJECT_DIR}/dist/cli/index.js"
      exit 1
    fi
    success "Source verified: dist/ with $(find "${PROJECT_DIR}/dist" -name '*.js' | wc -l) JS files"
  fi

  # ── Step 2: Create runtime user/group ──────────────────────────────────────
  info "Step 2/8: Creating runtime user/group..."

  if getent group "$DEVNULL_GROUP" &>/dev/null; then
    success "Group '${DEVNULL_GROUP}' already exists"
  else
    if command -v groupadd &>/dev/null; then
      groupadd --system "$DEVNULL_GROUP"
      success "Group '${DEVNULL_GROUP}' created"
    elif command -v addgroup &>/dev/null; then
      addgroup -S "$DEVNULL_GROUP" 2>/dev/null || true
      success "Group '${DEVNULL_GROUP}' created (Alpine)"
    else
      warn "Cannot create group '${DEVNULL_GROUP}' — continuing (may need sudo)"
    fi
  fi

  if id "$DEVNULL_USER" &>/dev/null; then
    success "User '${DEVNULL_USER}' already exists"
  else
    if command -v useradd &>/dev/null; then
      useradd --system --gid "$DEVNULL_GROUP" --home-dir "$DEVNULL_HOME" --no-create-home "$DEVNULL_USER"
      success "User '${DEVNULL_USER}' created"
    elif command -v adduser &>/dev/null; then
      adduser -S -D -h "$DEVNULL_HOME" -G "$DEVNULL_GROUP" "$DEVNULL_USER" 2>/dev/null || true
      success "User '${DEVNULL_USER}' created (Alpine)"
    else
      warn "Cannot create user '${DEVNULL_USER}' — continuing (may need sudo)"
    fi
  fi

  # ── Step 3: Create runtime directories ─────────────────────────────────────
  info "Step 3/8: Creating runtime directories..."

  local dirs=(
    "${DEVNULL_HOME}"
    "${DEVNULL_HOME}/dist"
    "${DEVNULL_HOME}/agent"
    "${DEVNULL_HOME}/agent/config"
    "${DEVNULL_HOME}/agent/skills"
    "${DEVNULL_HOME}/.log"
    "/workspace"
    "/workspace/.log"
  )

  for dir in "${dirs[@]}"; do
    mkdir -p "$dir"
  done
  success "Runtime directories created under ${DEVNULL_HOME}"

  # ── Step 4: Extract/copy artifact files ────────────────────────────────────
  info "Step 4/8: Installing artifact files..."

  if [ "$INSTALL_FROM_TARBALL" = true ]; then
    info "Extracting tarball to ${DEVNULL_HOME}..."
    tar -xzf "$TARBALL_PATH" -C "$DEVNULL_HOME"
    success "Tarball extracted to ${DEVNULL_HOME}"
  else
    # Copy compiled JS
    info "Copying dist/ (compiled JS)..."
    cp -r "${PROJECT_DIR}/dist/"* "${DEVNULL_HOME}/dist/"
    success "dist/ copied (${DEVNULL_HOME}/dist/)"

    # Copy agent skills and config
    info "Copying agent/ (skills, protocol, config)..."
    cp -r "${PROJECT_DIR}/agent/"* "${DEVNULL_HOME}/agent/"
    success "agent/ copied (${DEVNULL_HOME}/agent/)"

    # Copy package manifests
    info "Copying package manifests..."
    cp "${PROJECT_DIR}/package.json" "${DEVNULL_HOME}/package.json"
    if [ -f "${PROJECT_DIR}/package-lock.json" ]; then
      cp "${PROJECT_DIR}/package-lock.json" "${DEVNULL_HOME}/package-lock.json"
    fi
    success "Package manifests copied"

    # Copy .env.example (never overwrite existing .env)
    info "Copying .env.example..."
    if [ -f "${PROJECT_DIR}/.env.example" ]; then
      cp -n "${PROJECT_DIR}/.env.example" "${DEVNULL_HOME}/.env.example" 2>/dev/null || true
      success ".env.example copied (existing file preserved)"
    fi
  fi

  # ── Step 5: Install production dependencies ────────────────────────────────
  info "Step 5/8: Installing production npm dependencies..."

  if [ -f "${DEVNULL_HOME}/package.json" ]; then
    cd "$DEVNULL_HOME"
    npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5
    success "Production dependencies installed"
    cd "$PROJECT_DIR"
  else
    warn "No package.json found at ${DEVNULL_HOME} — skipping npm install"
  fi

  # ── Step 6: Create symlink ─────────────────────────────────────────────────
  info "Step 6/8: Creating devnull symlink..."

  if [ -f "${DEVNULL_HOME}/dist/cli/index.js" ]; then
    # Symlink into /usr/local/bin for global access
    if [ -d "/usr/local/bin" ]; then
      ln -sf "${DEVNULL_HOME}/dist/cli/index.js" "/usr/local/bin/devnull"
      chmod +x "${DEVNULL_HOME}/dist/cli/index.js"
      success "Symlink created: /usr/local/bin/devnull → ${DEVNULL_HOME}/dist/cli/index.js"
    else
      warn "/usr/local/bin not found — symlink not created"
      warn "  Add ${DEVNULL_HOME}/dist/cli/ to your PATH manually"
    fi
  else
    warn "CLI entry point not found — symlink not created"
  fi

  # ── Step 7: Set permissions ────────────────────────────────────────────────
  info "Step 7/8: Setting permissions..."

  chown -R "${DEVNULL_USER}:${DEVNULL_GROUP}" "${DEVNULL_HOME}" 2>/dev/null || warn "Could not chown ${DEVNULL_HOME} (run with sudo if needed)"
  chown -R "${DEVNULL_USER}:${DEVNULL_GROUP}" "/workspace" 2>/dev/null || warn "Could not chown /workspace"

  # Ensure log directories are writable
  chmod 755 "${DEVNULL_HOME}/.log" 2>/dev/null || true
  chmod 755 "/workspace/.log" 2>/dev/null || true

  success "Permissions set"

  # ── Step 8: Validate installation ──────────────────────────────────────────
  info "Step 8/8: Validating installation..."

  local errors=0

  # Check CLI runs
  if command -v node &>/dev/null; then
    local help_output
    help_output=$(node "${DEVNULL_HOME}/dist/cli/index.js" --help 2>&1) || true
    if echo "$help_output" | grep -q "Usage:"; then
      success "CLI runs: node ${DEVNULL_HOME}/dist/cli/index.js --help"
    else
      error "CLI --help output doesn't contain expected header"
      errors=$((errors + 1))
    fi
  else
    warn "Node.js not found — skipping CLI validation"
  fi

  # Check key files exist
  local required_files=(
    "${DEVNULL_HOME}/dist/cli/index.js"
    "${DEVNULL_HOME}/dist/core/orchestrator.js"
    "${DEVNULL_HOME}/dist/core/skillRegistry.js"
    "${DEVNULL_HOME}/dist/core/types.js"
    "${DEVNULL_HOME}/dist/llm/deepseekClient.js"
    "${DEVNULL_HOME}/dist/tools/toolDispatcher.js"
    "${DEVNULL_HOME}/dist/api/server.js"
    "${DEVNULL_HOME}/dist/api/routes.js"
    "${DEVNULL_HOME}/package.json"
    "${DEVNULL_HOME}/.env.example"
  )

  for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
      success "File present: ${file#${DEVNULL_HOME}/}"
    else
      error "Required file missing: ${file#${DEVNULL_HOME}/}"
      errors=$((errors + 1))
    fi
  done

  # Check agent skills
  local skill_count
  skill_count=$(find "${DEVNULL_HOME}/agent/skills" -name "SKILL.md" 2>/dev/null | wc -l)
  if [ "$skill_count" -gt 0 ]; then
    success "Agent skills: ${skill_count} SKILL.md files found"
  else
    warn "No SKILL.md files found in ${DEVNULL_HOME}/agent/skills/"
  fi

  # Check node_modules
  if [ -d "${DEVNULL_HOME}/node_modules" ]; then
    success "node_modules/ present (production dependencies)"
  else
    warn "node_modules/ not found — run 'npm install --omit=dev' in ${DEVNULL_HOME}"
  fi

  echo ""
  if [ "$errors" -eq 0 ]; then
    success "Installation complete! devnull is installed at ${DEVNULL_HOME}"
    echo ""
    echo "  Quick start:"
    echo "    devnull --skills              # List all loaded skills"
    echo "    devnull --index               # Index the current workspace"
    echo "    devnull --task \"your task\"    # Run a task"
    echo "    devnull --chat                # Interactive chat mode"
    echo ""
    echo "  To configure:"
    echo "    cp ${DEVNULL_HOME}/.env.example .env"
    echo "    # Edit .env and add your DEEPSEEK_API_KEY"
    echo ""
  else
    error "Installation completed with ${errors} error(s)"
    exit 1
  fi
}

main "$@"
