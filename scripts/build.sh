#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# build.sh — Unified build & packaging script for devnull
#
# Usage:
#   ./scripts/build.sh              # Full build: compile + validate
#   ./scripts/build.sh --compile    # TypeScript compilation only
#   ./scripts/build.sh --validate   # Validate existing dist/ only
#   ./scripts/build.sh --docker     # Build Docker images
#   ./scripts/build.sh --tarball    # Build + create deploy tarball
#   ./scripts/build.sh --all        # Full build + Docker + tarball
#
# Produces:
#   dist/           — Compiled JavaScript (no .ts source)
#   devnull-deploy.tar.gz  — Deploy tarball (if --tarball or --all)
#
# Environment:
#   NODE_ENV        — Set to "production" for production builds (default)
#   DOCKER_TAG      — Docker image tag (default: "latest")
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_TAG="${DOCKER_TAG:-latest}"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ─── Help ────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTION]

Options:
  --compile      TypeScript compilation only
  --validate     Validate existing dist/ only
  --docker       Build Docker images (api + ui)
  --tarball      Build + create deploy tarball
  --all          Full build + Docker + tarball (default)
  --help         Show this help message
EOF
  exit 0
}

# ─── Step 1: TypeScript Compilation ──────────────────────────────────────────
compile() {
  info "Compiling TypeScript..."
  cd "$PROJECT_DIR"

  # Clean previous build
  rm -rf dist/

  # Run TypeScript compiler
  npx tsc -p tsconfig.json

  # Verify output
  if [ ! -f "dist/cli/index.js" ]; then
    error "Compilation failed — dist/cli/index.js not found"
    exit 1
  fi

  success "TypeScript compilation complete"
  success "Output: $(find dist/ -name '*.js' | wc -l) JS files in dist/"
}

# ─── Step 2: Validate Build Output ───────────────────────────────────────────
validate() {
  local errors=0
  info "Validating build output..."

  cd "$PROJECT_DIR"

  # 2a. Check dist/ exists
  if [ ! -d "dist" ]; then
    error "dist/ directory not found. Run 'npm run build' first."
    exit 1
  fi

  # 2b. Check CLI entry point
  if [ ! -f "dist/cli/index.js" ]; then
    error "dist/cli/index.js not found"
    errors=$((errors + 1))
  else
    success "CLI entry point: dist/cli/index.js"
  fi

  # 2c. Check no .ts files leaked into dist/
  local ts_files
  ts_files=$(find dist/ -name '*.ts' 2>/dev/null | head -5)
  if [ -n "$ts_files" ]; then
    error "TypeScript source files found in dist/:"
    echo "$ts_files" | while read -r f; do echo "    $f"; done
    errors=$((errors + 1))
  else
    success "No .ts source files in dist/"
  fi

  # 2d. Check key modules exist
  local required_modules=(
    "dist/cli/index.js"
    "dist/core/orchestrator.js"
    "dist/core/skillRegistry.js"
    "dist/core/taskHistory.js"
    "dist/core/types.js"
    "dist/llm/deepseekClient.js"
    "dist/tools/toolDispatcher.js"
    "dist/tools/toolSchemas.js"
    "dist/api/server.js"
    "dist/api/routes.js"
  )

  for mod in "${required_modules[@]}"; do
    if [ ! -f "$mod" ]; then
      error "Required module missing: $mod"
      errors=$((errors + 1))
    else
      success "Module present: $mod"
    fi
  done

  # 2e. Check CLI runs independently
  if command -v node &>/dev/null; then
    local help_output
    help_output=$(node dist/cli/index.js --help 2>&1) || true
    if echo "$help_output" | grep -q "Usage:"; then
      success "CLI runs independently: node dist/cli/index.js --help"
    else
      error "CLI --help output doesn't contain expected header"
      errors=$((errors + 1))
    fi
  fi

  # 2f. Check source maps exist (for debugging)
  local sm_count
  sm_count=$(find dist/ -name '*.js.map' | wc -l)
  if [ "$sm_count" -gt 0 ]; then
    success "Source maps present: $sm_count .js.map files"
  else
    warn "No source maps found (set sourceMap: true in tsconfig.json)"
  fi

  echo ""
  if [ "$errors" -eq 0 ]; then
    success "Build validation PASSED — all checks OK"
  else
    error "Build validation FAILED — $errors error(s) found"
    exit 1
  fi
}

# ─── Step 3: Build Docker Images ─────────────────────────────────────────────
build_docker() {
  info "Building Docker images..."

  cd "$PROJECT_DIR"

  # Build API image
  info "Building devnull-api:${DOCKER_TAG}..."
  docker build \
    --build-arg NODE_IMAGE=node:20-alpine \
    -t "devnull-api:${DOCKER_TAG}" \
    -f Dockerfile \
    .

  success "API image built: devnull-api:${DOCKER_TAG}"

  # Build UI image
  info "Building devnull-ui:${DOCKER_TAG}..."
  docker build \
    -t "devnull-ui:${DOCKER_TAG}" \
    -f ui/Dockerfile \
    ui/

  success "UI image built: devnull-ui:${DOCKER_TAG}"

  # Show image sizes
  echo ""
  info "Image sizes:"
  docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}" \
    | grep -E "devnull-(api|ui)" || true
}

# ─── Step 4: Create Deploy Tarball ───────────────────────────────────────────
build_tarball() {
  info "Creating deploy tarball..."

  cd "$PROJECT_DIR"

  # Ensure dist/ exists
  if [ ! -d "dist" ]; then
    warn "dist/ not found — running compilation first"
    compile
  fi

  # Run the Node.js tarball script
  node scripts/create-deploy-tarball.mjs

  success "Deploy tarball created"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  local mode="${1:---all}"

  echo "══════════════════════════════════════════════════════════════════════"
  echo "  devnull Build & Packaging"
  echo "  Project: $PROJECT_DIR"
  echo "  Mode:    $mode"
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""

  case "$mode" in
    --compile)
      compile
      ;;
    --validate)
      validate
      ;;
    --docker)
      build_docker
      ;;
    --tarball)
      compile
      build_tarball
      ;;
    --all|"")
      compile
      validate
      build_tarball
      echo ""
      success "Full build complete"
      ;;
    --help|-h)
      show_help
      ;;
    *)
      error "Unknown option: $mode"
      echo "Usage: $(basename "$0") [--compile|--validate|--docker|--tarball|--all|--help]"
      exit 1
      ;;
  esac
}

main "$@"
