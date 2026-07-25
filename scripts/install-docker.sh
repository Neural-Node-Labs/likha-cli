#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# install-docker.sh — Docker-based installation for devnull
#
# Builds/pulls Docker images, creates docker-compose override for production,
# sets up volumes and networks, initializes the database container, and
# validates that all services are healthy.
#
# Usage:
#   ./scripts/install-docker.sh                    # Build and deploy locally
#   ./scripts/install-docker.sh --pull             # Pull from registry instead of build
#   ./scripts/install-docker.sh --tag v0.2.0       # Use specific image tag
#   ./scripts/install-docker.sh --compose-file ... # Custom compose file
#   ./scripts/install-docker.sh --help             # Show help
#
# Environment:
#   DOCKER_TAG      — Docker image tag (default: latest)
#   COMPOSE_PROJECT_NAME — Docker Compose project name (default: devnull)
#
# Idempotency:
#   - docker compose up -d is safe to re-run
#   - Volumes persist across re-runs
#   - Database initialization runs only on first start
#   - Safe to re-run at any time
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
DOCKER_TAG="${DOCKER_TAG:-latest}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-devnull}"
PULL_MODE=false
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
COMPOSE_OVERRIDE=""

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

Docker-based installation for devnull.

Options:
  --pull                Pull images from registry instead of building
  --tag TAG             Docker image tag (default: latest)
  --compose-file FILE   Custom docker-compose file (default: docker-compose.yml)
  --override FILE       Docker Compose override file (e.g., docker-compose.prod.yml)
  --help                Show this help message

Environment variables:
  DOCKER_TAG            Docker image tag (overrides --tag)
  COMPOSE_PROJECT_NAME  Docker Compose project name (default: devnull)

Idempotent: safe to re-run at any time.
EOF
  exit 0
}

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull)
      PULL_MODE=true
      shift
      ;;
    --tag)
      DOCKER_TAG="$2"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --override)
      COMPOSE_OVERRIDE="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      ;;
    *)
      error "Unknown option: $1"
      echo "Usage: $(basename "$0") [--pull] [--tag TAG] [--compose-file FILE] [--help]"
      exit 1
      ;;
  esac
done

# ─── Check prerequisites ─────────────────────────────────────────────────────
check_prereqs() {
  info "Checking prerequisites..."

  if ! command -v docker &>/dev/null; then
    error "Docker not found. Install Docker first: https://docs.docker.com/get-docker/"
    exit 1
  fi
  success "Docker found: $(docker --version 2>&1)"

  if ! docker info &>/dev/null; then
    error "Docker daemon is not running or current user lacks permissions"
    error "  Ensure Docker is running and your user is in the 'docker' group"
    exit 1
  fi
  success "Docker daemon is running"

  if ! command -v docker compose &>/dev/null; then
    error "Docker Compose not found. Install Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
  fi
  success "Docker Compose found: $(docker compose version 2>&1)"

  # Check compose file exists
  if [ ! -f "$COMPOSE_FILE" ]; then
    error "Compose file not found: ${COMPOSE_FILE}"
    exit 1
  fi
  success "Compose file found: ${COMPOSE_FILE}"

  if [ -n "$COMPOSE_OVERRIDE" ] && [ ! -f "$COMPOSE_OVERRIDE" ]; then
    warn "Compose override file not found: ${COMPOSE_OVERRIDE} — continuing without override"
    COMPOSE_OVERRIDE=""
  fi
}

# ─── Build or pull images ────────────────────────────────────────────────────
prepare_images() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Preparing Docker Images"
  echo "══════════════════════════════════════════════════════════════════════"

  if [ "$PULL_MODE" = true ]; then
    info "Pulling images from registry..."
    docker compose -f "$COMPOSE_FILE" ${COMPOSE_OVERRIDE:+-f "$COMPOSE_OVERRIDE"} pull
    success "Images pulled"
  else
    info "Building images locally..."
    # Build API image
    info "Building devnull-api:${DOCKER_TAG}..."
    docker build \
      --build-arg NODE_IMAGE=node:20-alpine \
      -t "devnull-api:${DOCKER_TAG}" \
      -f "${PROJECT_DIR}/Dockerfile" \
      "${PROJECT_DIR}"
    success "API image built: devnull-api:${DOCKER_TAG}"

    # Build UI image if Dockerfile exists
    if [ -f "${PROJECT_DIR}/ui/Dockerfile" ]; then
      info "Building devnull-ui:${DOCKER_TAG}..."
      docker build \
        -t "devnull-ui:${DOCKER_TAG}" \
        -f "${PROJECT_DIR}/ui/Dockerfile" \
        "${PROJECT_DIR}/ui"
      success "UI image built: devnull-ui:${DOCKER_TAG}"
    else
      warn "UI Dockerfile not found — skipping UI image build"
    fi
  fi

  # Show image sizes
  echo ""
  info "Image sizes:"
  docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}" \
    | grep -E "devnull-(api|ui)" || true
}

# ─── Create production override file ─────────────────────────────────────────
create_production_override() {
  local override_file="${PROJECT_DIR}/docker-compose.prod.yml"

  if [ -f "$override_file" ]; then
    info "Production override already exists: ${override_file}"
    return
  fi

  info "Creating production docker-compose override..."

  cat > "$override_file" <<'YAML'
# docker-compose.prod.yml — Production override for devnull
#
# Usage:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
#
# This override:
#   - Sets restart policy to 'always'
#   - Adds resource limits
#   - Configures log rotation
#   - Sets production environment variables

services:
  postgres:
    restart: always
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  api:
    restart: always
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    environment:
      - NODE_ENV=production
    deploy:
      resources:
        limits:
          cpus: "1"
          memory: "2G"
        reservations:
          cpus: "0.25"
          memory: "256M"

  ui:
    restart: always
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: "256M"
        reservations:
          cpus: "0.1"
          memory: "64M"
YAML

  success "Production override created: ${override_file}"
}

# ─── Create .env if not exists ───────────────────────────────────────────────
ensure_env_file() {
  local env_file="${PROJECT_DIR}/.env"

  if [ -f "$env_file" ]; then
    info ".env file already exists: ${env_file}"
    return
  fi

  if [ -f "${PROJECT_DIR}/.env.example" ]; then
    info "Creating .env from .env.example..."
    cp "${PROJECT_DIR}/.env.example" "$env_file"
    warn ".env created from template — edit it to add your DEEPSEEK_API_KEY"
    chmod 600 "$env_file"
  else
    warn "No .env.example found — create .env manually"
  fi
}

# ─── Start services ──────────────────────────────────────────────────────────
start_services() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Starting Services"
  echo "══════════════════════════════════════════════════════════════════════"

  local compose_args=("-f" "$COMPOSE_FILE")
  if [ -n "$COMPOSE_OVERRIDE" ]; then
    compose_args+=("-f" "$COMPOSE_OVERRIDE")
  fi
  compose_args+=("up" "-d")

  info "Running: docker compose ${compose_args[*]}"
  docker compose "${compose_args[@]}"

  success "Services started"
}

# ─── Wait for healthy services ───────────────────────────────────────────────
wait_for_health() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Waiting for Services to be Healthy"
  echo "══════════════════════════════════════════════════════════════════════"

  local timeout=120
  local interval=5
  local elapsed=0

  info "Waiting up to ${timeout}s for services to become healthy..."

  while [ $elapsed -lt $timeout ]; do
    local all_healthy=true

    # Check postgres
    local pg_status
    pg_status=$(docker compose -f "$COMPOSE_FILE" ${COMPOSE_OVERRIDE:+-f "$COMPOSE_OVERRIDE"} ps --format json postgres 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    if [ "$pg_status" != "healthy" ]; then
      all_healthy=false
    fi

    # Check api
    local api_status
    api_status=$(docker compose -f "$COMPOSE_FILE" ${COMPOSE_OVERRIDE:+-f "$COMPOSE_OVERRIDE"} ps --format json api 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    if [ "$api_status" != "healthy" ]; then
      all_healthy=false
    fi

    # Check ui (if it exists in compose)
    local ui_status
    ui_status=$(docker compose -f "$COMPOSE_FILE" ${COMPOSE_OVERRIDE:+-f "$COMPOSE_OVERRIDE"} ps --format json ui 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "")
    if [ -n "$ui_status" ] && [ "$ui_status" != "healthy" ]; then
      all_healthy=false
    fi

    if [ "$all_healthy" = true ]; then
      success "All services healthy!"
      echo ""
      info "Service status:"
      docker compose -f "$COMPOSE_FILE" ${COMPOSE_OVERRIDE:+-f "$COMPOSE_OVERRIDE"} ps
      return 0
    fi

    sleep $interval
    elapsed=$((elapsed + interval))
    info "  Waiting... (${elapsed}s / ${timeout}s)"
  done

  warn "Timeout reached — not all services are healthy"
  warn "Check logs: docker compose logs"
  return 1
}

# ─── Validate deployment ─────────────────────────────────────────────────────
validate_deployment() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Validating Deployment"
  echo "══════════════════════════════════════════════════════════════════════"

  local errors=0

  # Check API health endpoint
  info "Checking API health endpoint..."
  local api_health
  api_health=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/v1/health 2>/dev/null || echo "000")
  if [ "$api_health" = "200" ]; then
    success "API health endpoint: HTTP 200"
  else
    warn "API health endpoint returned HTTP ${api_health}"
    errors=$((errors + 1))
  fi

  # Check UI is serving
  info "Checking UI..."
  local ui_status
  ui_status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ 2>/dev/null || echo "000")
  if [ "$ui_status" = "200" ]; then
    success "UI serving: HTTP 200"
  else
    warn "UI returned HTTP ${ui_status}"
    errors=$((errors + 1))
  fi

  # Check container status
  info "Checking container status..."
  docker compose -f "$COMPOSE_FILE" ${COMPOSE_OVERRIDE:+-f "$COMPOSE_OVERRIDE"} ps

  echo ""
  if [ "$errors" -eq 0 ]; then
    success "Deployment validation passed!"
  else
    warn "Deployment validation completed with ${errors} warning(s)"
  fi
}

# ─── Print summary ───────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  devnull Docker Installation Complete"
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""
  echo "  Services:"
  echo "    API:    http://localhost:3001"
  echo "    UI:     http://localhost:8080"
  echo "    DB:     localhost:5432"
  echo ""
  echo "  Management:"
  echo "    docker compose logs -f api     # View API logs"
  echo "    docker compose logs -f ui      # View UI logs"
  echo "    docker compose down            # Stop all services"
  echo "    docker compose up -d           # Start all services"
  echo ""
  echo "  CLI usage:"
  echo "    docker compose run --rm api --task \"your task\""
  echo "    docker compose run --rm api --chat"
  echo ""
  echo "  Configuration:"
  echo "    Edit .env to set your DEEPSEEK_API_KEY"
  echo "    Then restart: docker compose restart api"
  echo ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  devnull Docker Installation"
  echo "  Tag:   ${DOCKER_TAG}"
  echo "  Mode:  $([ "$PULL_MODE" = true ] && echo "pull from registry" || echo "build locally")"
  echo "══════════════════════════════════════════════════════════════════════"

  check_prereqs
  ensure_env_file
  prepare_images
  create_production_override
  start_services
  wait_for_health
  validate_deployment
  print_summary
}

main "$@"
