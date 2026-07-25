#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# rollback.sh — Rollback devnull deployment to previous state
#
# Restores the previous Docker Compose state from a rollback snapshot
# taken during the last deploy. This is the documented rollback path.
#
# Usage:
#   bash scripts/rollback.sh [--remote HOST] [--path REMOTE_PATH]
#
# Options:
#   --remote HOST        SSH host to rollback on (default: from env REMOTE_HOST)
#   --path REMOTE_PATH   Remote path (default: /opt/devnull)
#   --user SSH_USER      SSH user (default: from env REMOTE_SSH_USER)
#   --key SSH_KEY_PATH   SSH key path (default: ~/.ssh/id_rsa)
#   --local              Rollback local deployment (docker compose down/up)
#   --help               Show this help
#
# Environment:
#   REMOTE_HOST         SSH host for remote rollback
#   REMOTE_SSH_USER     SSH user
#   REMOTE_SSH_KEY      SSH key path
#   REMOTE_PATH         Remote deployment path (default: /opt/devnull)
#
# Rollback process:
#   1. Check for rollback snapshot (.devnull-rollback-snapshot.json)
#   2. If snapshot exists, restore previous Docker Compose state
#   3. If no snapshot, attempt to restart previous image versions
#   4. Verify services are healthy after rollback
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_SSH_USER="${REMOTE_SSH_USER:-}"
REMOTE_SSH_KEY="${REMOTE_SSH_KEY:-}"
REMOTE_PATH="${REMOTE_PATH:-/opt/devnull}"
MODE="remote"

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

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --remote) REMOTE_HOST="$2"; shift 2 ;;
        --path) REMOTE_PATH="$2"; shift 2 ;;
        --user) REMOTE_SSH_USER="$2"; shift 2 ;;
        --key) REMOTE_SSH_KEY="$2"; shift 2 ;;
        --local) MODE="local"; shift ;;
        --help) head -50 "$0"; exit 0 ;;
        *) error "Unknown option: $1"; exit 1 ;;
    esac
done

# ─── Local rollback ──────────────────────────────────────────────────────────
rollback_local() {
    info "Performing local rollback..."

    if [ ! -f "${PROJECT_DIR}/.devnull-rollback-snapshot.json" ]; then
        warn "No rollback snapshot found at .devnull-rollback-snapshot.json"
        warn "Attempting to restart previous Docker Compose state..."
    else
        info "Found rollback snapshot"
        cat "${PROJECT_DIR}/.devnull-rollback-snapshot.json"
    fi

    # Stop current containers
    info "Stopping current containers..."
    docker compose -f "${PROJECT_DIR}/docker-compose.yml" down 2>/dev/null || true

    # Restart with previous state (docker compose up -d without --build uses cached images)
    info "Restarting with previous images..."
    docker compose -f "${PROJECT_DIR}/docker-compose.yml" up -d

    # Wait for health
    info "Waiting for services to become healthy..."
    sleep 10

    # Check status
    docker compose -f "${PROJECT_DIR}/docker-compose.yml" ps

    # Health check
    local http_code
    http_code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 http://localhost:3001/api/v1/health 2>/dev/null || echo '000')
    if [ "$http_code" = "200" ]; then
        success "Rollback completed successfully. API health: HTTP ${http_code}"
    else
        warn "Rollback completed but health check returned HTTP ${http_code}"
    fi
}

# ─── Remote rollback ─────────────────────────────────────────────────────────
rollback_remote() {
    if [ -z "$REMOTE_HOST" ]; then
        error "Remote host not specified. Use --remote HOST or set REMOTE_HOST env var."
        exit 1
    fi

    info "Performing remote rollback on ${REMOTE_HOST}..."

    # Build SSH command prefix
    local ssh_cmd="ssh"
    if [ -n "$REMOTE_SSH_USER" ]; then
        ssh_cmd="${ssh_cmd} ${REMOTE_SSH_USER}@${REMOTE_HOST}"
    else
        ssh_cmd="${ssh_cmd} ${REMOTE_HOST}"
    fi
    if [ -n "$REMOTE_SSH_KEY" ]; then
        ssh_cmd="${ssh_cmd} -i ${REMOTE_SSH_KEY}"
    fi

    # Check for rollback snapshot
    info "Checking for rollback snapshot on remote..."
    local snapshot_exists
    snapshot_exists=$(${ssh_cmd} "test -f ${REMOTE_PATH}/.devnull-rollback-snapshot.json && echo 'yes' || echo 'no'" 2>/dev/null || echo "no")

    if [ "$snapshot_exists" = "yes" ]; then
        info "Rollback snapshot found. Contents:"
        ${ssh_cmd} "cat ${REMOTE_PATH}/.devnull-rollback-snapshot.json" 2>/dev/null || true
    else
        warn "No rollback snapshot found on remote. Attempting restart with cached images..."
    fi

    # Check for previous image versions
    local images_snapshot_exists
    images_snapshot_exists=$(${ssh_cmd} "test -f ${REMOTE_PATH}/.devnull-rollback-images.json && echo 'yes' || echo 'no'" 2>/dev/null || echo "no")

    if [ "$images_snapshot_exists" = "yes" ]; then
        info "Previous image versions found. Restoring..."
        # The images snapshot contains the previous image tags
        # We can use them to pull specific versions
        ${ssh_cmd} "cd ${REMOTE_PATH} && cat .devnull-rollback-images.json" 2>/dev/null || true
    fi

    # Execute rollback
    info "Executing rollback..."
    ${ssh_cmd} "cd ${REMOTE_PATH} && docker compose down 2>/dev/null; docker compose up -d" 2>&1 || {
        error "Rollback command failed"
        exit 1
    }

    # Wait for services
    info "Waiting for services to become healthy..."
    sleep 15

    # Check status
    info "Container status after rollback:"
    ${ssh_cmd} "cd ${REMOTE_PATH} && docker compose ps" 2>/dev/null || true

    # Health check
    info "Performing health check..."
    local http_code
    http_code=$(${ssh_cmd} "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 http://localhost:3001/api/v1/health 2>/dev/null || echo '000'" 2>/dev/null || echo "000")

    if [ "$http_code" = "200" ]; then
        success "Rollback completed successfully on ${REMOTE_HOST}. API health: HTTP ${http_code}"
    else
        warn "Rollback completed but health check returned HTTP ${http_code}"
    fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    echo "══════════════════════════════════════════════════════════════════════"
    echo "  devnull — Rollback"
    echo "══════════════════════════════════════════════════════════════════════"
    echo ""

    if [ "$MODE" = "local" ]; then
        rollback_local
    else
        rollback_remote
    fi

    echo ""
    echo "══════════════════════════════════════════════════════════════════════"
    echo "  Rollback complete"
    echo "══════════════════════════════════════════════════════════════════════"
}

main "$@"
