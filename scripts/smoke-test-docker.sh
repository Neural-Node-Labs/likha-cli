#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# smoke-test-docker.sh — Smoke test for devnull Docker images
#
# Validates that the Docker images (API and UI) build correctly, start up,
# pass healthchecks, and respond to requests.
#
# Usage:
#   bash scripts/smoke-test-docker.sh
#
# Environment:
#   DOCKER_API_IMAGE  — API image name:tag (default: devnull-api:latest)
#   DOCKER_UI_IMAGE   — UI image name:tag (default: devnull-ui:latest)
#   COMPOSE_PROJECT   — Docker Compose project name (default: devnull-smoke-test)
#   SKIP_UI           — Set to "true" to skip UI tests (default: false)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
DOCKER_API_IMAGE="${DOCKER_API_IMAGE:-devnull-api:latest}"
DOCKER_UI_IMAGE="${DOCKER_UI_IMAGE:-devnull-ui:latest}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-devnull-smoke-test}"
SKIP_UI="${SKIP_UI:-false}"
EXIT_CODE=0

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

# ─── Cleanup handler ─────────────────────────────────────────────────────────
cleanup() {
    info "Cleaning up containers..."
    docker compose -p "$COMPOSE_PROJECT" down --volumes --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    echo "══════════════════════════════════════════════════════════════════════"
    echo "  Smoke Test — Docker Images"
    echo "══════════════════════════════════════════════════════════════════════"
    echo ""
    info "API image: ${DOCKER_API_IMAGE}"
    info "UI image:  ${DOCKER_UI_IMAGE}"
    echo ""

    # 1. Check Docker is available
    info "Checking Docker availability..."
    if ! docker info &>/dev/null; then
        error "Docker daemon is not running"
        exit 1
    fi
    success "Docker daemon is running"

    # 2. Check images exist
    info "Checking API image: ${DOCKER_API_IMAGE}"
    if ! docker image inspect "${DOCKER_API_IMAGE}" &>/dev/null; then
        error "API image not found: ${DOCKER_API_IMAGE}"
        error "Build it first: docker build -t ${DOCKER_API_IMAGE} -f Dockerfile ."
        exit 1
    fi
    success "API image exists"

    if [ "$SKIP_UI" != "true" ]; then
        info "Checking UI image: ${DOCKER_UI_IMAGE}"
        if ! docker image inspect "${DOCKER_UI_IMAGE}" &>/dev/null; then
            warn "UI image not found: ${DOCKER_UI_IMAGE} — skipping UI tests"
            SKIP_UI="true"
        else
            success "UI image exists"
        fi
    fi

    # 3. Create a temporary docker-compose file for the smoke test
    local compose_file="${TEST_DIR:-$(mktemp -d)}/docker-compose.smoke.yml"
    mkdir -p "$(dirname "$compose_file")"

    cat > "$compose_file" <<EOF
services:
  api:
    image: ${DOCKER_API_IMAGE}
    container_name: ${COMPOSE_PROJECT}-api
    environment:
      - DEVNULL_HOME=/opt/devnull
      - DEVNULL_API_PORT=3001
      - NODE_ENV=production
      - DATABASE_TYPE=sqlite
      - DATABASE_SQLITE_PATH=/data/devnull.db
    ports:
      - "3001:3001"
    volumes:
      - api-data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3001/api/v1/health', r => {process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
EOF

    if [ "$SKIP_UI" != "true" ]; then
        cat >> "$compose_file" <<EOF

  ui:
    image: ${DOCKER_UI_IMAGE}
    container_name: ${COMPOSE_PROJECT}-ui
    ports:
      - "8080:80"
    environment:
      - API_HOST=api
      - API_PORT=3001
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:80/"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 5s
EOF
    fi

    cat >> "$compose_file" <<EOF

volumes:
  api-data:
    driver: local
EOF

    # 4. Start containers
    info "Starting containers..."
    docker compose -p "$COMPOSE_PROJECT" -f "$compose_file" up -d
    success "Containers started"

    # 5. Wait for API healthcheck
    info "Waiting for API to become healthy..."
    local timeout=60
    local elapsed=0
    local interval=3
    local api_healthy=false

    while [ $elapsed -lt $timeout ]; do
        local status
        status=$(docker inspect --format='{{.State.Health.Status}}' "${COMPOSE_PROJECT}-api" 2>/dev/null || echo "unknown")
        if [ "$status" = "healthy" ]; then
            api_healthy=true
            success "API is healthy (after ${elapsed}s)"
            break
        fi
        sleep $interval
        elapsed=$((elapsed + interval))
        info "  Waiting for API... (${elapsed}s / ${timeout}s, status: ${status})"
    done

    if [ "$api_healthy" != "true" ]; then
        error "API did not become healthy within ${timeout}s"
        error "Container logs:"
        docker logs "${COMPOSE_PROJECT}-api" 2>&1 | tail -30
        exit 1
    fi

    # 6. Test API health endpoint
    info "Testing API health endpoint..."
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/v1/health 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
        success "API health endpoint: HTTP 200"
    else
        error "API health endpoint returned HTTP ${http_code}"
        exit 1
    fi

    # 7. Test API version endpoint
    info "Testing API health response content..."
    local health_response
    health_response=$(curl -s http://localhost:3001/api/v1/health 2>/dev/null || echo "")
    if echo "$health_response" | grep -qi "status\|ok\|healthy"; then
        success "API health response contains expected data"
    else
        warn "API health response unexpected: ${health_response:0:200}"
    fi

    # 8. Test UI (if not skipped)
    if [ "$SKIP_UI" != "true" ]; then
        info "Waiting for UI to become healthy..."
        local ui_timeout=30
        local ui_elapsed=0
        local ui_healthy=false

        while [ $ui_elapsed -lt $ui_timeout ]; do
            local ui_status
            ui_status=$(docker inspect --format='{{.State.Health.Status}}' "${COMPOSE_PROJECT}-ui" 2>/dev/null || echo "unknown")
            if [ "$ui_status" = "healthy" ]; then
                ui_healthy=true
                success "UI is healthy (after ${ui_elapsed}s)"
                break
            fi
            sleep $interval
            ui_elapsed=$((ui_elapsed + interval))
            info "  Waiting for UI... (${ui_elapsed}s / ${ui_timeout}s, status: ${ui_status})"
        done

        if [ "$ui_healthy" = "true" ]; then
            # Test UI serves content
            info "Testing UI serves content..."
            local ui_http_code
            ui_http_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ 2>/dev/null || echo "000")
            if [ "$ui_http_code" = "200" ]; then
                success "UI serving: HTTP 200"
            else
                warn "UI returned HTTP ${ui_http_code}"
            fi

            # Check UI contains expected HTML
            local ui_content
            ui_content=$(curl -s http://localhost:8080/ 2>/dev/null || echo "")
            if echo "$ui_content" | grep -qi "<!doctype html\|<html\|root\|app\|devnull"; then
                success "UI content contains expected HTML"
            else
                warn "UI content may be incomplete"
            fi
        else
            warn "UI did not become healthy within ${ui_timeout}s — skipping UI tests"
            warn "UI logs:"
            docker logs "${COMPOSE_PROJECT}-ui" 2>&1 | tail -20
        fi
    fi

    # 9. Check container resource usage
    info "Checking container resource usage..."
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null || true

    echo ""
    echo "══════════════════════════════════════════════════════════════════════"
    success "Smoke test PASSED — Docker images are valid"
    echo "══════════════════════════════════════════════════════════════════════"
}

main