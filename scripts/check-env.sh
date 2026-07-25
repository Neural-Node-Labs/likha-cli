#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# check-env.sh — Pre-flight environment validation for devnull
#
# Validates that required environment variables are set, Docker is available,
# and the deployment environment is properly configured before running a deploy.
#
# Usage:
#   bash scripts/check-env.sh [--env-file .env] [--mode production|staging]
#
# Options:
#   --env-file FILE   Path to .env file to validate (default: .env)
#   --mode MODE       Deployment mode: production or staging (default: production)
#   --docker          Also check Docker availability
#   --quiet           Only output errors (exit code only)
#   --help            Show this help
#
# Exit codes:
#   0  — All checks passed
#   1  — Missing required env vars
#   2  — Docker not available
#   3  — .env file not found
#   4  — Other validation failure
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
ENV_FILE="${PROJECT_DIR}/.env"
MODE="production"
CHECK_DOCKER=false
QUIET=false

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { [ "$QUIET" = false ] && echo -e "${BLUE}[INFO]${NC} $*"; }
success() { [ "$QUIET" = false ] && echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { [ "$QUIET" = false ] && echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --env-file) ENV_FILE="$2"; shift 2 ;;
        --mode) MODE="$2"; shift 2 ;;
        --docker) CHECK_DOCKER=true; shift ;;
        --quiet) QUIET=true; shift ;;
        --help) head -40 "$0"; exit 0 ;;
        *) error "Unknown option: $1"; exit 4 ;;
    esac
done

# ─── Validation functions ────────────────────────────────────────────────────

check_env_file() {
    if [ ! -f "$ENV_FILE" ]; then
        error ".env file not found: ${ENV_FILE}"
        error "Copy .env.example to .env and fill in required values:"
        error "  cp .env.example .env"
        exit 3
    fi
    success ".env file found: ${ENV_FILE}"
}

check_var() {
    local var_name="$1"
    local required="$2"
    local description="$3"

    # Source the env file to get the value
    local value
    value=$(grep -E "^${var_name}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- || echo "")

    # Remove quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"

    if [ -z "$value" ] || [ "$value" = "your_${var_name,,}_here" ] || [ "$value" = "your_${var_name,,}_key_here" ]; then
        if [ "$required" = "true" ]; then
            error "  ${var_name} — REQUIRED but not set or still has placeholder value"
            error "    Description: ${description}"
            return 1
        else
            warn "  ${var_name} — optional, not set"
            return 0
        fi
    else
        # Mask the value for display
        local masked
        if [ ${#value} -gt 8 ]; then
            masked="${value:0:4}...${value: -4}"
        else
            masked="****"
        fi
        success "  ${var_name}=${masked}"
        return 0
    fi
}

check_docker() {
    if ! command -v docker &>/dev/null; then
        error "Docker is not installed"
        exit 2
    fi
    success "Docker CLI available: $(docker --version 2>/dev/null)"

    if ! docker info &>/dev/null; then
        error "Docker daemon is not running"
        exit 2
    fi
    success "Docker daemon is running"

    if ! docker compose version &>/dev/null; then
        error "Docker Compose is not available"
        exit 2
    fi
    success "Docker Compose available: $(docker compose version 2>/dev/null)"
}

check_node() {
    if ! command -v node &>/dev/null; then
        warn "Node.js is not installed (needed for local development)"
        return 0
    fi
    success "Node.js available: $(node --version 2>/dev/null)"
}

check_git() {
    if ! command -v git &>/dev/null; then
        warn "Git is not installed (needed for github_tool)"
        return 0
    fi
    success "Git available: $(git --version 2>/dev/null)"
}

check_disk_space() {
    local min_space_mb="${1:-500}"
    local available_mb

    if command -v df &>/dev/null; then
        available_mb=$(df -m "$PROJECT_DIR" 2>/dev/null | tail -1 | awk '{print $4}' || echo "0")
        if [ "$available_mb" -lt "$min_space_mb" ]; then
            warn "Low disk space: ${available_mb}MB available (minimum: ${min_space_mb}MB)"
        else
            success "Disk space: ${available_mb}MB available"
        fi
    fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    local exit_code=0

    echo "══════════════════════════════════════════════════════════════════════"
    echo "  Environment Validation — ${MODE}"
    echo "══════════════════════════════════════════════════════════════════════"
    echo ""

    # 1. Check .env file exists
    info "Checking .env file..."
    check_env_file

    # 2. Source the env file for validation
    set -a
    source "$ENV_FILE" 2>/dev/null || true
    set +a

    # 3. Validate required variables
    echo ""
    info "Validating environment variables..."

    # Core required variables
    check_var "DEEPSEEK_API_KEY" "true" "DeepSeek API key (primary LLM provider)" || exit_code=1

    # Optional but important variables
    check_var "ANTHROPIC_API_KEY" "false" "Anthropic API key (fallback LLM provider)"
    check_var "GITHUB_TOKEN" "false" "GitHub token for github_tool operations"
    check_var "DEVNULL_API_KEY" "false" "API server authentication key"

    # Database variables (check based on mode)
    echo ""
    info "Checking database configuration..."

    local db_type
    db_type=$(grep -E "^DATABASE_TYPE=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- || echo "sqlite")
    db_type="${db_type%\"}"
    db_type="${db_type#\"}"

    if [ "$db_type" = "postgres" ] || [ "$db_type" = "postgresql" ]; then
        info "Database type: PostgreSQL"
        check_var "DATABASE_URL" "false" "PostgreSQL connection string (overrides individual params)"
        if [ -z "$(grep -E "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null)" ]; then
            check_var "DATABASE_HOST" "true" "PostgreSQL host" || exit_code=1
            check_var "DATABASE_PORT" "false" "PostgreSQL port"
            check_var "DATABASE_NAME" "true" "PostgreSQL database name" || exit_code=1
            check_var "DATABASE_USER" "true" "PostgreSQL user" || exit_code=1
            check_var "DATABASE_PASSWORD" "true" "PostgreSQL password" || exit_code=1
        fi
    else
        info "Database type: SQLite (zero-config)"
    fi

    # 4. Check tooling availability
    echo ""
    info "Checking tooling availability..."
    check_node
    check_git

    # 5. Check Docker (if requested)
    if [ "$CHECK_DOCKER" = true ]; then
        echo ""
        info "Checking Docker availability..."
        check_docker
    fi

    # 6. Check disk space
    echo ""
    info "Checking disk space..."
    check_disk_space 500

    # 7. Summary
    echo ""
    if [ "$exit_code" -eq 0 ]; then
        success "All environment checks passed!"
    else
        error "Some checks failed. Review the errors above."
    fi

    exit $exit_code
}

main "$@"
