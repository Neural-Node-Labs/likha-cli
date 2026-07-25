#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# setup.sh — Unified devnull setup orchestrator
#
# Orchestrates the full setup flow: install artifact, initialize database,
# configure secrets, and validate end-to-end. Designed to be idempotent —
# safe to re-run at any time.
#
# Usage:
#   ./scripts/setup.sh                          # Full interactive setup
#   ./scripts/setup.sh --non-interactive        # Non-interactive (use env vars)
#   ./scripts/setup.sh --skip-db                # Skip database initialization
#   ./scripts/setup.sh --skip-install           # Skip artifact installation
#   ./scripts/setup.sh --prefix /opt/devnull    # Custom install prefix
#   ./scripts/setup.sh --help                   # Show help
#
# Environment:
#   All variables from install.sh and init-db.sh apply.
#   Additionally:
#   DEEPSEEK_API_KEY    — DeepSeek API key (prompted if not set)
#   ANTHROPIC_API_KEY   — Anthropic API key (optional, prompted if not set)
#   GITHUB_TOKEN        — GitHub token (optional, prompted if not set)
#   DEVNULL_API_KEY     — API auth key (optional, prompted if not set)
#   SKIP_SECRET_PROMPT  — If set, skip interactive secret prompts
#
# Idempotency:
#   - Delegates to install.sh (idempotent)
#   - Delegates to init-db.sh (idempotent)
#   - .env file is never overwritten if it exists
#   - Safe to re-run at any time
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
DEVNULL_HOME="${DEVNULL_HOME:-/opt/devnull}"
NON_INTERACTIVE=false
SKIP_DB=false
SKIP_INSTALL=false
SETUP_ENV_FILE=""

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
prompt()  { echo -e "${CYAN}[INPUT]${NC} $*"; }

# ─── Help ────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Unified devnull setup orchestrator.

Options:
  --non-interactive     Skip all interactive prompts (use env vars)
  --skip-db             Skip database initialization
  --skip-install        Skip artifact installation
  --prefix DIR          Installation prefix (default: /opt/devnull)
  --env-file FILE       Path to write .env file (default: .env in CWD)
  --help                Show this help message

Environment variables:
  DEEPSEEK_API_KEY      DeepSeek API key
  ANTHROPIC_API_KEY     Anthropic API key (optional)
  GITHUB_TOKEN          GitHub token (optional)
  DEVNULL_API_KEY       API auth key (optional)
  SKIP_SECRET_PROMPT    Skip interactive secret prompts if set

Idempotent: safe to re-run at any time.
EOF
  exit 0
}

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    --skip-db)
      SKIP_DB=true
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    --prefix)
      DEVNULL_HOME="$2"
      shift 2
      ;;
    --env-file)
      SETUP_ENV_FILE="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      ;;
    *)
      error "Unknown option: $1"
      echo "Usage: $(basename "$0") [--non-interactive] [--skip-db] [--skip-install] [--prefix DIR] [--help]"
      exit 1
      ;;
  esac
done

# ─── Resolve .env file path ──────────────────────────────────────────────────
if [ -z "$SETUP_ENV_FILE" ]; then
  SETUP_ENV_FILE="${PROJECT_DIR}/.env"
fi

# ─── Step 1: Install artifact ────────────────────────────────────────────────
install_artifact() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 1: Install Artifact"
  echo "══════════════════════════════════════════════════════════════════════"

  if [ "$SKIP_INSTALL" = true ]; then
    info "Skipping artifact installation (--skip-install)"
    return
  fi

  local install_args=("--prefix" "$DEVNULL_HOME")

  # Check if tarball exists
  if [ -f "${PROJECT_DIR}/devnull-deploy.tar.gz" ]; then
    info "Deploy tarball found — installing from tarball"
    install_args+=("--from-tarball")
  elif [ -d "${PROJECT_DIR}/dist" ]; then
    info "dist/ found — installing from source"
  else
    warn "Neither dist/ nor devnull-deploy.tar.gz found"
    warn "Run 'npm run build' or 'npm run package:tarball' first"
    prompt "Attempt to build from source? [Y/n] "
    if [ "$NON_INTERACTIVE" = true ]; then
      error "Cannot build in non-interactive mode. Run 'npm run build' first."
      exit 1
    fi
    read -r answer
    if [[ "$answer" =~ ^[Nn] ]]; then
      error "Installation aborted"
      exit 1
    fi
    info "Building from source..."
    (cd "$PROJECT_DIR" && npm run build)
    info "Build complete"
  fi

  bash "${SCRIPT_DIR}/install.sh" "${install_args[@]}"
  success "Artifact installation complete"
}

# ─── Step 2: Initialize database ─────────────────────────────────────────────
init_database() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 2: Initialize Database"
  echo "══════════════════════════════════════════════════════════════════════"

  if [ "$SKIP_DB" = true ]; then
    info "Skipping database initialization (--skip-db)"
    return
  fi

  local db_args=()

  if [ -n "${DATABASE_URL:-}" ]; then
    db_args+=("--db-url" "$DATABASE_URL")
  fi

  if bash "${SCRIPT_DIR}/init-db.sh" "${db_args[@]}"; then
    success "Database initialization complete"
  else
    warn "Database initialization failed (non-fatal — can be run later)"
    warn "  Run: ./scripts/init-db.sh"
  fi
}

# ─── Step 3: Configure secrets ───────────────────────────────────────────────
configure_secrets() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 3: Configure Secrets"
  echo "══════════════════════════════════════════════════════════════════════"

  # Check if .env already exists
  if [ -f "$SETUP_ENV_FILE" ]; then
    info ".env file already exists at ${SETUP_ENV_FILE}"
    info "Existing secrets will be preserved"
    prompt "Review and update? [y/N] "
    if [ "$NON_INTERACTIVE" = true ]; then
      info "Non-interactive mode — keeping existing .env"
      return
    fi
    read -r answer
    if [[ ! "$answer" =~ ^[Yy] ]]; then
      info "Keeping existing .env"
      return
    fi
  fi

  # Collect secrets
  local deepseek_key="${DEEPSEEK_API_KEY:-}"
  local anthropic_key="${ANTHROPIC_API_KEY:-}"
  local github_token="${GITHUB_TOKEN:-}"
  local api_key="${DEVNULL_API_KEY:-}"

  if [ "$NON_INTERACTIVE" = false ]; then
    # Prompt for DeepSeek API key
    if [ -z "$deepseek_key" ]; then
      prompt "Enter your DeepSeek API key (required): "
      read -r deepseek_key
    fi

    # Prompt for optional keys
    if [ -z "$anthropic_key" ]; then
      prompt "Enter your Anthropic API key (optional, press Enter to skip): "
      read -r anthropic_key
    fi

    if [ -z "$github_token" ]; then
      prompt "Enter your GitHub token (optional, press Enter to skip): "
      read -r github_token
    fi

    if [ -z "$api_key" ]; then
      prompt "Enter API auth key (optional, press Enter to skip): "
      read -r api_key
    fi
  fi

  # Write .env file
  info "Writing .env file to ${SETUP_ENV_FILE}..."

  # Backup existing .env if present
  if [ -f "$SETUP_ENV_FILE" ]; then
    local backup="${SETUP_ENV_FILE}.backup.$(date +%Y%m%d%H%M%S)"
    cp "$SETUP_ENV_FILE" "$backup"
    info "Existing .env backed up to ${backup}"
  fi

  cat > "$SETUP_ENV_FILE" <<EOF
# devnull environment configuration
# Generated by setup.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Default LLM provider is DeepSeek (see agent/config/llm.yaml)
DEEPSEEK_API_KEY=${deepseek_key}

# Optional fallback provider, used only if DeepSeek is unreachable / unset
ANTHROPIC_API_KEY=${anthropic_key}

# Used by github_tool for HTTPS auth on clone/fetch/pull/push
GITHUB_TOKEN=${github_token}

# API server authentication. If set, all /api/v1/* endpoints require
# Authorization: Bearer <DEVNULL_API_KEY>
DEVNULL_API_KEY=${api_key}

# PostgreSQL connection (used by API server mode)
DATABASE_URL=postgresql://\${POSTGRES_USER:-devnull}:\${POSTGRES_PASSWORD:-devnull_pass}@\${POSTGRES_HOST:-localhost}:5432/\${POSTGRES_DB:-devnull}

# ReAct loop iteration ceiling per round (default: 10)
# MAX_ITERATIONS=25
EOF

  # Set restrictive permissions on .env
  chmod 600 "$SETUP_ENV_FILE"

  success "Secrets configured at ${SETUP_ENV_FILE}"
  warn "Keep this file secure — it contains API keys!"
}

# ─── Step 4: Validate end-to-end ─────────────────────────────────────────────
validate_setup() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 4: Validate Setup"
  echo "══════════════════════════════════════════════════════════════════════"

  local errors=0

  # 4a. Check CLI runs
  info "Checking CLI..."
  if command -v devnull &>/dev/null; then
    local help_output
    help_output=$(devnull --help 2>&1) || true
    if echo "$help_output" | grep -q "Usage:"; then
      success "CLI works: devnull --help"
    else
      warn "devnull --help output unexpected"
      errors=$((errors + 1))
    fi
  elif command -v node &>/dev/null && [ -f "${DEVNULL_HOME}/dist/cli/index.js" ]; then
    local help_output
    help_output=$(node "${DEVNULL_HOME}/dist/cli/index.js" --help 2>&1) || true
    if echo "$help_output" | grep -q "Usage:"; then
      success "CLI works: node ${DEVNULL_HOME}/dist/cli/index.js --help"
    else
      warn "CLI --help output unexpected"
      errors=$((errors + 1))
    fi
  else
    warn "CLI not found — skipping CLI validation"
  fi

  # 4b. Check skills load
  info "Checking skills..."
  if command -v devnull &>/dev/null; then
    local skills_output
    skills_output=$(devnull --skills 2>&1) || true
    local skill_count
    skill_count=$(echo "$skills_output" | grep -c "SKILL.md" || true)
    if [ "$skill_count" -gt 0 ]; then
      success "Skills loaded: ${skill_count} skills found"
    else
      warn "No skills found via --skills"
    fi
  fi

  # 4c. Check .env exists
  info "Checking configuration..."
  if [ -f "$SETUP_ENV_FILE" ]; then
    success ".env file present at ${SETUP_ENV_FILE}"
    # Check if DEEPSEEK_API_KEY is set (not placeholder)
    if grep -q "DEEPSEEK_API_KEY=your_deepseek_api_key_here" "$SETUP_ENV_FILE" 2>/dev/null; then
      warn "DEEPSEEK_API_KEY is still the placeholder value — update it before using LLM features"
    elif grep -q "DEEPSEEK_API_KEY=" "$SETUP_ENV_FILE" 2>/dev/null; then
      success "DEEPSEEK_API_KEY is configured"
    fi
  else
    warn "No .env file found at ${SETUP_ENV_FILE}"
  fi

  # 4d. Check database (if not skipped)
  if [ "$SKIP_DB" = false ] && command -v psql &>/dev/null; then
    info "Checking database..."
    local db_url="${DATABASE_URL:-postgresql://devnull:devnull_pass@localhost:5432/devnull}"
    if psql "$db_url" -c "SELECT 1" &>/dev/null; then
      success "Database connection OK"
      # Count tables
      local table_count
      table_count=$(psql "$db_url" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d ' ' || echo "0")
      success "Database tables: ${table_count}"
    else
      warn "Database not reachable — run ./scripts/init-db.sh later"
    fi
  fi

  echo ""
  if [ "$errors" -eq 0 ]; then
    success "Setup validation passed!"
  else
    warn "Setup validation completed with ${errors} warning(s)"
  fi
}

# ─── Summary ─────────────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  devnull Setup Complete"
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""
  echo "  Installation:  ${DEVNULL_HOME}"
  echo "  Config:        ${SETUP_ENV_FILE}"
  echo "  Database:      $([ "$SKIP_DB" = false ] && echo "Initialized" || echo "Skipped")"
  echo ""
  echo "  Quick start:"
  echo "    devnull --skills              # List all loaded skills"
  echo "    devnull --index               # Index the current workspace"
  echo "    devnull --task \"your task\"    # Run a task"
  echo "    devnull --chat                # Interactive chat mode"
  echo ""
  echo "  API server:"
  echo "    devnull --serve               # Start API server (port 3001)"
  echo ""
  echo "  Docker:"
  echo "    docker compose up -d          # Start full stack"
  echo ""
  echo "  Need help?"
  echo "    devnull --help                # Show all CLI options"
  echo "    See README.md for full documentation"
  echo ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  devnull Setup"
  echo "  Mode:  $([ "$NON_INTERACTIVE" = true ] && echo "non-interactive" || echo "interactive")"
  echo "══════════════════════════════════════════════════════════════════════"

  install_artifact
  init_database
  configure_secrets
  validate_setup
  print_summary
}

main "$@"
