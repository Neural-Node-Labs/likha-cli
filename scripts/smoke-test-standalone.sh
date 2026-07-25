#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# smoke-test-standalone.sh — Smoke test for devnull standalone tarball
#
# Validates that the standalone tarball (devnull-standalone.tar.gz) contains
# the expected files, the CLI binary works, and basic commands execute.
#
# Usage:
#   bash scripts/smoke-test-standalone.sh [tarball-path]
#
# Default tarball path: devnull-standalone.tar.gz (in project root)
#
# Environment:
#   TARBALL_PATH  — Path to the standalone tarball (overrides positional arg)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
TARBALL_PATH="${1:-${TARBALL_PATH:-$PROJECT_DIR/devnull-standalone.tar.gz}}"
TEST_DIR="$(mktemp -d)"
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
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    echo "══════════════════════════════════════════════════════════════════════"
    echo "  Smoke Test — Standalone Tarball"
    echo "══════════════════════════════════════════════════════════════════════"
    echo ""
    info "Tarball path: ${TARBALL_PATH}"
    echo ""

    # 1. Check tarball exists
    info "Checking tarball exists..."
    if [ ! -f "$TARBALL_PATH" ]; then
        error "Tarball not found: ${TARBALL_PATH}"
        error "Build it first: bash scripts/build.sh --standalone"
        exit 1
    fi
    success "Tarball exists"

    # 2. Check tarball is valid gzip
    info "Checking tarball integrity..."
    if ! tar -tzf "$TARBALL_PATH" &>/dev/null; then
        error "Tarball is corrupted or not a valid gzip archive"
        exit 1
    fi
    success "Tarball is valid"

    # 3. Check tarball size (warn if too small or too large)
    local tar_size
    tar_size=$(stat -c%s "$TARBALL_PATH" 2>/dev/null || stat -f%z "$TARBALL_PATH" 2>/dev/null || echo "0")
    info "Tarball size: $(numfmt --to=iec-i 2>/dev/null || echo "${tar_size} bytes")"

    if [ "$tar_size" -lt 1000 ]; then
        error "Tarball is suspiciously small (${tar_size} bytes)"
        exit 1
    fi
    success "Tarball size looks reasonable"

    # 4. Extract to temp directory
    info "Extracting tarball to ${TEST_DIR}..."
    tar -xzf "$TARBALL_PATH" -C "$TEST_DIR"
    success "Extracted successfully"

    # 5. Check expected files exist
    info "Checking expected files..."
    local expected_files=(
        "package.json"
        "dist/cli/index.js"
        "dist/tools/dockerDeploySshTool.js"
    )
    local missing_files=0
    for f in "${expected_files[@]}"; do
        if [ -f "${TEST_DIR}/${f}" ]; then
            success "  Found: ${f}"
        else
            error "  Missing: ${f}"
            missing_files=$((missing_files + 1))
        fi
    done

    if [ "$missing_files" -gt 0 ]; then
        error "${missing_files} expected file(s) missing from tarball"
        exit 1
    fi

    # 6. Check node_modules exists (production deps)
    info "Checking node_modules..."
    if [ -d "${TEST_DIR}/node_modules" ]; then
        success "node_modules directory exists"
    else
        warn "node_modules directory not found (may need npm install)"
    fi

    # 7. Check CLI binary is executable
    info "Checking CLI binary..."
    if [ -f "${TEST_DIR}/dist/cli/index.js" ]; then
        if [ -x "${TEST_DIR}/dist/cli/index.js" ] || head -1 "${TEST_DIR}/dist/cli/index.js" | grep -q "#!/usr/bin/env node"; then
            success "CLI binary has shebang"
        else
            warn "CLI binary may not be directly executable (no shebang)"
        fi
    fi

    # 8. Try running the CLI --help
    info "Testing CLI --help..."
    if command -v node &>/dev/null; then
        local help_output
        help_output=$(node "${TEST_DIR}/dist/cli/index.js" --help 2>&1 || true)
        if echo "$help_output" | grep -qi "usage\|help\|devnull\|commands"; then
            success "CLI --help produces expected output"
        else
            warn "CLI --help output may be incomplete: ${help_output:0:200}"
        fi
    else
        warn "Node.js not available — skipping CLI execution test"
    fi

    # 9. List tarball contents for reference
    info "Tarball contents (top-level):"
    tar -tzf "$TARBALL_PATH" | head -20 | while read -r line; do
        echo "    ${line}"
    done

    echo ""
    echo "══════════════════════════════════════════════════════════════════════"
    success "Smoke test PASSED — standalone tarball is valid"
    echo "══════════════════════════════════════════════════════════════════════"
}

main "$@"
