#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# devnull-server.sh — Standalone devnull API server launcher (no Docker)
#
# Starts the devnull HTTP API server with SQLite database backend.
# The SQLite database is auto-created on first run — no separate DB process needed.
#
# Usage:
#   ./scripts/devnull-server.sh                    # Start on default port 3001
#   DEVNULL_API_PORT=8080 ./scripts/devnull-server.sh  # Custom port
#   ./scripts/devnull-server.sh --help             # Show help
#
# Environment:
#   DEVNULL_API_PORT    — API server port (default: 3001)
#   DEVNULL_API_HOST    — API server bind address (default: 0.0.0.0)
#   DEVNULL_HOME        — Runtime home directory (default: /opt/devnull or project root)
#   DEEPSEEK_API_KEY    — Required for LLM features (set in .env)
#   NODE_ENV            — Runtime environment (default: production)
#
# Signals:
#   SIGTERM/SIGINT — Graceful shutdown (waits for active requests to complete)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
DEVNULL_HOME="${DEVNULL_HOME:-${PROJECT_DIR}}"
DEVNULL_API_PORT="${DEVNULL_API_PORT:-3001}"
DEVNULL_API_HOST="${DEVNULL_API_HOST:-0.0.0.0}"
NODE_ENV="${NODE_ENV:-production}"

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

# ─── Help ────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Start the devnull API server (standalone, no Docker).

Options:
  --port PORT       API server port (default: 3001, or \$DEVNULL_API_PORT)
  --host HOST       API server bind address (default: 0.0.0.0, or \$DEVNULL_API_HOST)
  --help            Show this help message

Environment variables:
  DEVNULL_API_PORT    Port (default: 3001)
  DEVNULL_API_HOST    Host (default: 0.0.0.0)
  DEVNULL_HOME        Runtime home directory
  DEEPSEEK_API_KEY    DeepSeek API key (required for LLM features)
  NODE_ENV            Runtime environment (default: production)

The SQLite database is auto-created at ~/.devnull/data/devnull.db on first run.
No separate database process is required.

Examples:
  ./scripts/devnull-server.sh
  DEVNULL_API_PORT=8080 ./scripts/devnull-server.sh
  ./scripts/devnull-server.sh --port 8080 --host 127.0.0.1
EOF
  exit 0
}

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      DEVNULL_API_PORT="$2"
      shift 2
      ;;
    --host)
      DEVNULL_API_HOST="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      ;;
    *)
      error "Unknown option: $1"
      echo "Usage: $(basename "$0") [--port PORT] [--host HOST] [--help]"
      exit 1
      ;;
  esac
done

# ─── Pre-flight checks ───────────────────────────────────────────────────────
preflight() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  devnull Server Launcher"
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""

  # Check Node.js
  if ! command -v node &>/dev/null; then
    error "Node.js is not installed or not on PATH."
    error "Install Node.js 20+ from https://nodejs.org/"
    exit 1
  fi

  local node_version
  node_version=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$node_version" -lt 18 ]; then
    error "Node.js 18+ required (found: $(node --version))"
    exit 1
  fi
  success "Node.js $(node --version)"

  # Check for compiled JS
  if [ ! -f "${DEVNULL_HOME}/dist/cli/index.js" ]; then
    error "Compiled JS not found at ${DEVNULL_HOME}/dist/cli/index.js"
    error "Run 'npm run build' first, or set DEVNULL_HOME to the package root."
    exit 1
  fi
  success "Build artifacts found at ${DEVNULL_HOME}/dist/"

  # Check for node_modules
  if [ ! -d "${DEVNULL_HOME}/node_modules" ]; then
    error "node_modules/ not found at ${DEVNULL_HOME}/node_modules"
    error "Run 'npm install --omit=dev' first."
    exit 1
  fi
  success "Production dependencies installed"

  # Check .env
  if [ -f "${DEVNULL_HOME}/.env" ]; then
    success ".env file found"
  else
    warn ".env file not found at ${DEVNULL_HOME}/.env"
    warn "Copy .env.example to .env and configure your API keys."
    warn "The server will start but LLM features may not work."
  fi

  # Create required runtime directories
  mkdir -p "${DEVNULL_HOME}/.log"
  mkdir -p "${DEVNULL_HOME}/.agent/index"
  success "Runtime directories created/verified"
}

# ─── Start server ────────────────────────────────────────────────────────────
start_server() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Starting devnull API Server"
  echo "  Port: ${DEVNULL_API_PORT}"
  echo "  Host: ${DEVNULL_API_HOST}"
  echo "  Home: ${DEVNULL_HOME}"
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""

  # Export environment variables for the Node.js process
  export DEVNULL_HOME
  export DEVNULL_API_PORT
  export DEVNULL_API_HOST
  export NODE_ENV

  # Load .env if it exists
  if [ -f "${DEVNULL_HOME}/.env" ]; then
    set -a
    source "${DEVNULL_HOME}/.env"
    set +a
    success "Environment loaded from .env"
  fi

  # Change to the project directory
  cd "${DEVNULL_HOME}"

  # Trap signals for graceful shutdown
  trap 'graceful_shutdown' SIGTERM SIGINT

  # Start the server
  info "Starting server..."
  echo ""
  node dist/cli/index.js --serve --port "$DEVNULL_API_PORT" --host "$DEVNULL_API_HOST" &
  SERVER_PID=$!
  echo "  PID: ${SERVER_PID}"

  # Wait for the server to start
  sleep 2

  # Verify the server is running
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    success "Server started successfully"
    echo ""
    echo "  API:      http://${DEVNULL_API_HOST}:${DEVNULL_API_PORT}"
    echo "  Health:   http://${DEVNULL_API_HOST}:${DEVNULL_API_PORT}/api/v1/health"
    echo "  PID:      ${SERVER_PID}"
    echo "  Logs:     ${DEVNULL_HOME}/.log/"
    echo "  SQLite:   ~/.devnull/data/devnull.db"
    echo ""
    echo "  Press Ctrl+C to stop the server."
    echo ""
  else
    error "Server failed to start"
    exit 1
  fi

  # Wait for the server process
  wait "$SERVER_PID"
}

# ─── Graceful shutdown ───────────────────────────────────────────────────────
graceful_shutdown() {
  echo ""
  info "Received shutdown signal. Stopping server (PID: ${SERVER_PID})..."
  kill -TERM "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  success "Server stopped."
  exit 0
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  preflight
  start_server
}

main
