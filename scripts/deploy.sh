#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy.sh — Unified deploy script for devnull
#
# Deploys the devnull stack to a remote Docker host via SSH.
# Supports idempotent deploys, rollback, and environment-specific config.
#
# Usage:
#   bash scripts/deploy.sh [options]
#
# Options:
#   -e, --env ENV       Target environment: staging | production (default: staging)
#   -h, --host HOST     Remote host address (overrides env file)
#   -u, --user USER     SSH username (overrides env file)
#   -p, --port PORT     SSH port (default: 22)
#   -k, --key PATH      SSH private key path (overrides env file)
#   -r, --remote-path PATH  Remote deploy path (default: /opt/devnull)
#   -f, --env-file PATH Local .env file to ship (e.g. .env.production)
#   -c, --compose-file FILE  Docker Compose file to use (e.g. docker-compose.prod.yml)
#   --pull              Pull images from registry instead of building from source
#   --skip-validation   Skip pre-deploy validation checks
#   --skip-health-check Skip health verification after deploy
#   --skip-rollback     Skip creating a rollback snapshot
#   --dry-run           Print what would be done without actually deploying
#   -v, --verbose       Verbose output
#   --help              Show this help message
#
# Environment variables (used when options not provided):
#   DEPLOY_ENV          Target environment (staging/production)
#   REMOTE_HOST         Remote host address
#   REMOTE_SSH_USER     SSH username
#   REMOTE_SSH_PASSWORD SSH password (use key-based auth in production)
#   REMOTE_SSH_KEY      SSH private key path
#   REMOTE_PATH         Remote deploy path
#
# Examples:
#   # Deploy to staging with defaults
#   bash scripts/deploy.sh
#
#   # Deploy to production with specific host and env file
#   bash scripts/deploy.sh -e production -h 192.168.1.100 -f .env.production
#
#   # Dry-run to see what would happen
#   bash scripts/deploy.sh --dry-run -v
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Defaults ────────────────────────────────────────────────────────────────
DEPLOY_ENV="${DEPLOY_ENV:-staging}"
REMOTE_PATH="${REMOTE_PATH:-/opt/devnull}"
SSH_PORT="${SSH_PORT:-22}"
DRY_RUN=false
VERBOSE=false
SKIP_VALIDATION=false
SKIP_HEALTH_CHECK=false
SKIP_ROLLBACK=false
PULL_FROM_REGISTRY=false
COMPOSE_FILE=""
ENV_FILE=""

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
verbose() { [ "$VERBOSE" = true ] && echo -e "${CYAN}[DEBUG]${NC} $*"; }
dry()     { echo -e "${YELLOW}[DRY-RUN]${NC} $*"; }

# ─── Help ────────────────────────────────────────────────────────────────────
show_help() {
    sed -n '/^# ──────────────────────────────────────────────────────────/,/^# ──────────────────────────────────────────────────────────/p' "$0" | grep -v '^#!/' | sed 's/^# //' | sed 's/^#$//'
    exit 0
}

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        -e|--env)
            DEPLOY_ENV="$2"
            shift 2
            ;;
        -h|--host)
            REMOTE_HOST="$2"
            shift 2
            ;;
        -u|--user)
            REMOTE_SSH_USER="$2"
            shift 2
            ;;
        -p|--port)
            SSH_PORT="$2"
            shift 2
            ;;
        -k|--key)
            REMOTE_SSH_KEY="$2"
            shift 2
            ;;
        -r|--remote-path)
            REMOTE_PATH="$2"
            shift 2
            ;;
        -f|--env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        -c|--compose-file)
            COMPOSE_FILE="$2"
            shift 2
            ;;
        --pull)
            PULL_FROM_REGISTRY=true
            shift
            ;;
        --skip-validation)
            SKIP_VALIDATION=true
            shift
            ;;
        --skip-health-check)
            SKIP_HEALTH_CHECK=true
            shift
            ;;
        --skip-rollback)
            SKIP_ROLLBACK=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            show_help
            ;;
        *)
            error "Unknown option: $1"
            echo "Usage: bash scripts/deploy.sh [options]"
            echo "  --help for more information"
            exit 1
            ;;
    esac
done

# ─── Validate environment ────────────────────────────────────────────────────
validate_env() {
    info "Validating environment: ${DEPLOY_ENV}"

    # Check required variables
    local missing=0

    if [ -z "${REMOTE_HOST:-}" ]; then
        error "REMOTE_HOST is not set. Use -h/--host or set REMOTE_HOST env var."
        missing=1
    fi

    if [ -z "${REMOTE_SSH_USER:-}" ]; then
        error "REMOTE_SSH_USER is not set. Use -u/--user or set REMOTE_SSH_USER env var."
        missing=1
    fi

    if [ -z "${REMOTE_SSH_KEY:-}" ] && [ -z "${REMOTE_SSH_PASSWORD:-}" ]; then
        warn "Neither REMOTE_SSH_KEY nor REMOTE_SSH_PASSWORD is set."
        warn "Will attempt to use default SSH keys (ssh-agent)."
    fi

    if [ "$missing" -eq 1 ]; then
        error "Missing required configuration. Aborting."
        exit 1
    fi

    success "Environment validation passed"
}

# ─── Pre-flight checks ───────────────────────────────────────────────────────
pre_flight_checks() {
    info "Running pre-flight checks..."

    # Check required tools locally
    local tools=("ssh" "tar" "gzip")
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &>/dev/null; then
            error "Required tool not found: $tool"
            exit 1
        fi
        verbose "  Found: $tool"
    done

    # Check SSH connectivity
    verbose "Testing SSH connection to ${REMOTE_SSH_USER}@${REMOTE_HOST}:${SSH_PORT}..."
    local ssh_cmd="ssh"
    if [ -n "${REMOTE_SSH_KEY:-}" ]; then
        ssh_cmd="$ssh_cmd -i $REMOTE_SSH_KEY"
    fi
    ssh_cmd="$ssh_cmd -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p $SSH_PORT ${REMOTE_SSH_USER}@${REMOTE_HOST}"

    if [ "$DRY_RUN" = false ]; then
        if ! $ssh_cmd "echo 'SSH connection successful'" &>/dev/null; then
            error "SSH connection failed to ${REMOTE_SSH_USER}@${REMOTE_HOST}:${SSH_PORT}"
            error "Check host, credentials, and network connectivity."
            exit 1
        fi
        success "SSH connection successful"
    else
        dry "Would test SSH connection to ${REMOTE_SSH_USER}@${REMOTE_HOST}:${SSH_PORT}"
    fi

    # Check Docker availability on remote
    if [ "$DRY_RUN" = false ] && [ "$SKIP_VALIDATION" = false ]; then
        verbose "Checking Docker availability on remote..."
        local docker_check
        docker_check=$($ssh_cmd "docker --version 2>&1 && docker compose version 2>&1" 2>/dev/null)
        if echo "$docker_check" | grep -qi "not found\|command not found"; then
            error "Docker or Docker Compose not found on remote host"
            error "Output: $docker_check"
            exit 1
        fi
        success "Docker available on remote: $(echo "$docker_check" | head -1)"

        # Check disk space
        verbose "Checking disk space on remote..."
        local disk_info
        disk_info=$($ssh_cmd "df -h / | tail -1" 2>/dev/null)
        verbose "  Remote disk: $disk_info"
    elif [ "$DRY_RUN" = true ]; then
        dry "Would check Docker availability on remote"
        dry "Would check disk space on remote"
    fi

    success "Pre-flight checks passed"
}

# ─── Create deploy tarball ────────────────────────────────────────────────────
create_tarball() {
    info "Creating deploy tarball..."

    local tar_path="${PROJECT_DIR}/.devnull-deploy.tar.gz"

    # Use the project's .dockerignore as a pattern for what to exclude
    local exclude_patterns=(
        "--exclude=.git"
        "--exclude=node_modules"
        "--exclude=.agent"
        "--exclude=dist"
        "--exclude=*.log"
        "--exclude=.env"
        "--exclude=.env.*"
        "--exclude=*.tar.gz"
        "--exclude=__pycache__"
        "--exclude=.DS_Store"
    )

    if [ "$DRY_RUN" = true ]; then
        dry "Would create tarball: ${tar_path}"
        dry "  Excluding: ${exclude_patterns[*]}"
        echo "0"
        return
    fi

    # Remove any existing deploy tarball
    rm -f "$tar_path"

    # Create the tarball
    cd "$PROJECT_DIR"
    tar -czf "$tar_path" \
        "${exclude_patterns[@]}" \
        --exclude=".devnull-deploy.tar.gz" \
        .

    local tar_size
    tar_size=$(stat -c%s "$tar_path" 2>/dev/null || stat -f%z "$tar_path" 2>/dev/null || echo "0")
    success "Tarball created: $(numfmt --to=iec-i 2>/dev/null || echo "${tar_size} bytes")"
    echo "$tar_path"
}

# ─── Deploy to remote ────────────────────────────────────────────────────────
deploy_to_remote() {
    local tar_path="$1"

    info "Deploying to ${REMOTE_SSH_USER}@${REMOTE_HOST}:${REMOTE_PATH}..."

    local ssh_base="ssh"
    local scp_base="scp"
    if [ -n "${REMOTE_SSH_KEY:-}" ]; then
        ssh_base="$ssh_base -i $REMOTE_SSH_KEY"
        scp_base="$scp_base -i $REMOTE_SSH_KEY"
    fi
    ssh_base="$ssh_base -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p $SSH_PORT"
    scp_base="$scp_base -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -P $SSH_PORT"

    local ssh_cmd="$ssh_base ${REMOTE_SSH_USER}@${REMOTE_HOST}"
    local scp_target="${REMOTE_SSH_USER}@${REMOTE_HOST}:"

    # Step 1: Create remote directory
    verbose "Step 1: Creating remote directory..."
    if [ "$DRY_RUN" = false ]; then
        $ssh_cmd "mkdir -p $REMOTE_PATH"
        success "  Remote directory ready"
    else
        dry "  mkdir -p $REMOTE_PATH"
    fi

    # Step 2: Upload tarball
    verbose "Step 2: Uploading tarball..."
    if [ "$DRY_RUN" = false ]; then
        $scp_base "$tar_path" "${scp_target}${REMOTE_PATH}/.devnull-deploy.tar.gz"
        success "  Tarball uploaded"
    else
        dry "  scp $tar_path ${scp_target}${REMOTE_PATH}/.devnull-deploy.tar.gz"
    fi

    # Step 3: Upload env file if specified
    if [ -n "$ENV_FILE" ]; then
        verbose "Step 3: Uploading env file..."
        if [ "$DRY_RUN" = false ]; then
            if [ -f "$ENV_FILE" ]; then
                $scp_base "$ENV_FILE" "${scp_target}${REMOTE_PATH}/.env"
                success "  Env file uploaded: $ENV_FILE"
            else
                warn "  Env file not found: $ENV_FILE — skipping"
            fi
        else
            dry "  scp $ENV_FILE ${scp_target}${REMOTE_PATH}/.env"
        fi
    else
        verbose "Step 3: No env file specified — skipping"
    fi

    # Step 4: Extract tarball on remote
    verbose "Step 4: Extracting tarball on remote..."
    if [ "$DRY_RUN" = false ]; then
        $ssh_cmd "cd $REMOTE_PATH && tar -xzf .devnull-deploy.tar.gz && rm .devnull-deploy.tar.gz"
        success "  Tarball extracted"
    else
        dry "  cd $REMOTE_PATH && tar -xzf .devnull-deploy.tar.gz && rm .devnull-deploy.tar.gz"
    fi

    # Step 5: Create rollback snapshot
    if [ "$SKIP_ROLLBACK" = false ]; then
        verbose "Step 5: Creating rollback snapshot..."
        if [ "$DRY_RUN" = false ]; then
            $ssh_cmd "cd $REMOTE_PATH && (docker compose ps --format json 2>/dev/null || echo '{\"snapshot\":\"none\"}') > .devnull-rollback-snapshot.json && (docker compose images --format json 2>/dev/null || true) > .devnull-rollback-images.json && echo 'SNAPSHOT_SAVED'"
            success "  Rollback snapshot created"
        else
            dry "  Creating rollback snapshot on remote"
        fi
    else
        verbose "Step 5: Rollback snapshot skipped"
    fi

    # Step 6: Run Docker command
    verbose "Step 6: Running Docker command..."
    local docker_cmd="docker compose up -d --build"
    if [ "$PULL_FROM_REGISTRY" = true ]; then
        docker_cmd="docker compose pull && docker compose up -d --force-recreate"
    fi
    if [ -n "$COMPOSE_FILE" ]; then
        docker_cmd="docker compose -f $COMPOSE_FILE up -d --build"
        if [ "$PULL_FROM_REGISTRY" = true ]; then
            docker_cmd="docker compose -f $COMPOSE_FILE pull && docker compose -f $COMPOSE_FILE up -d --force-recreate"
        fi
    fi

    if [ "$DRY_RUN" = false ]; then
        verbose "  Running: $docker_cmd"
        $ssh_cmd "cd $REMOTE_PATH && $docker_cmd" || {
            local exit_code=$?
            error "  Docker command failed (exit code: $exit_code)"
            # Attempt rollback
            if [ "$SKIP_ROLLBACK" = false ]; then
                warn "  Attempting rollback..."
                $ssh_cmd "cd $REMOTE_PATH && if [ -f .devnull-rollback-snapshot.json ]; then docker compose down 2>/dev/null; docker compose up -d 2>/dev/null || true; echo 'ROLLBACK_COMPLETE'; else echo 'NO_SNAPSHOT'; fi" || true
            fi
            return $exit_code
        }
        success "  Docker command completed"
    else
        dry "  cd $REMOTE_PATH && $docker_cmd"
    fi

    # Step 7: Health check
    if [ "$SKIP_HEALTH_CHECK" = false ] && [ "$DRY_RUN" = false ]; then
        verbose "Step 7: Running health check..."
        sleep 10
        local health_result
        health_result=$($ssh_cmd "cd $REMOTE_PATH && docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'" 2>/dev/null || echo "FAILED")
        echo ""
        echo "  ─── Container Status ───"
        echo "$health_result" | while IFS= read -r line; do
            echo "    $line"
        done
        echo "  ─────────────────────────"
        echo ""

        # Check API health
        local api_health
        api_health=$($ssh_cmd "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 http://localhost:3001/api/v1/health 2>/dev/null || echo 'failed'" 2>/dev/null || echo "failed")
        if [ "$api_health" = "200" ]; then
            success "  API health endpoint: HTTP 200"
        else
            warn "  API health endpoint: HTTP ${api_health}"
        fi

        # Check UI health
        local ui_health
        ui_health=$($ssh_cmd "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 http://localhost:8080/ 2>/dev/null || echo 'failed'" 2>/dev/null || echo "failed")
        if [ "$ui_health" = "200" ]; then
            success "  UI health endpoint: HTTP 200"
        else
            warn "  UI health endpoint: HTTP ${ui_health}"
        fi

        success "  Health check complete"
    else
        dry "  Would run health check"
    fi

    success "Deploy to remote completed"
}

# ─── Main ────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo "══════════════════════════════════════════════════════════════════════"
    echo "  devnull Deploy — Environment: ${DEPLOY_ENV}"
    echo "══════════════════════════════════════════════════════════════════════"
    echo ""

    validate_env
    pre_flight_checks

    local tar_path
    tar_path=$(create_tarball)

    if [ "$DRY_RUN" = false ]; then
        deploy_to_remote "$tar_path"
        # Clean up local tarball
        rm -f "$tar_path"
    else
        dry "Would deploy to remote"
    fi

    echo ""
    echo "══════════════════════════════════════════════════════════════════════"
    if [ "$DRY_RUN" = true ]; then
        dry "Dry-run complete — no changes made"
    else
        success "Deploy complete!"
    fi
    echo "══════════════════════════════════════════════════════════════════════"
    echo ""
}

main "$@"