#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# verify.sh — Protocol Workflow: Pre-Completion Verification
#
# Runs the full verification pipeline before marking a task complete:
#   1. TypeScript type checker (tsc --noEmit)
#   2. Linter (if available)
#   3. Test suite (vitest run)
#
# Logs results to tasks/verify-latest.log for audit trail.
#
# Usage:
#   bash scripts/verify.sh                    # Run all checks
#   bash scripts/verify.sh --typecheck        # Type check only
#   bash scripts/verify.sh --lint             # Lint only
#   bash scripts/verify.sh --test             # Tests only
#   bash scripts/verify.sh --list             # List recent verification logs
#   bash scripts/verify.sh --help             # Show this help
#
# Options:
#   --typecheck       Run TypeScript type checker only
#   --lint            Run linter only
#   --test            Run tests only
#   --list            List recent verification logs
#   --no-log          Skip writing to log file
#   --quiet           Minimal output (exit code only)
#
# Exit codes:
#   0 — All checks passed
#   1 — Type check failed
#   2 — Lint failed
#   3 — Tests failed
#   4 — Multiple checks failed
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
RUN_TYPECHECK=true
RUN_LINT=true
RUN_TEST=true
WRITE_LOG=true
QUIET=false
LIST_MODE=false
LOG_DIR="${PROJECT_DIR}/tasks"
LOG_FILE="${LOG_DIR}/verify-latest.log"
EXIT_CODE=0

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { [ "$QUIET" = false ] && echo -e "${BLUE}[INFO]${NC} $*"; }
success() { [ "$QUIET" = false ] && echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { [ "$QUIET" = false ] && echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  { [ "$QUIET" = false ] && echo -e "${CYAN}$*${NC}"; }

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --typecheck) RUN_LINT=false; RUN_TEST=false; shift ;;
        --lint) RUN_TYPECHECK=false; RUN_TEST=false; shift ;;
        --test) RUN_TYPECHECK=false; RUN_LINT=false; shift ;;
        --list) LIST_MODE=true; shift ;;
        --no-log) WRITE_LOG=false; shift ;;
        --quiet) QUIET=true; shift ;;
        --help|-h) head -30 "$0"; exit 0 ;;
        *) error "Unknown option: $1"; exit 4 ;;
    esac
done

# ─── Logging ─────────────────────────────────────────────────────────────────
log() {
    local level="$1"
    local message="$2"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[${timestamp}] [${level}] ${message}" >> "$LOG_FILE"
}

init_log() {
    if [ "$WRITE_LOG" = false ]; then
        return
    fi

    # Ensure log directory exists
    if [ ! -d "$LOG_DIR" ]; then
        mkdir -p "$LOG_DIR"
    fi

    # Rotate previous log
    if [ -f "$LOG_FILE" ]; then
        mv "$LOG_FILE" "${LOG_FILE}.prev" 2>/dev/null || true
    fi

    {
        echo "══════════════════════════════════════════════════════════════════════"
        echo "  Verification Report"
        echo "  Date: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "  Project: ${PROJECT_DIR}"
        echo "══════════════════════════════════════════════════════════════════════"
        echo ""
    } > "$LOG_FILE"
}

log_result() {
    local check_name="$1"
    local status="$2"  # PASS or FAIL
    local duration="$3"
    local details="$4"

    if [ "$WRITE_LOG" = true ]; then
        {
            echo "  Check:    ${check_name}"
            echo "  Status:   ${status}"
            echo "  Duration: ${duration}s"
            if [ -n "$details" ]; then
                echo "  Details:"
                echo "${details}" | sed 's/^/    /'
            fi
            echo ""
        } >> "$LOG_FILE"
    fi
}

# ─── List recent verification logs ───────────────────────────────────────────
list_logs() {
    header "Recent Verification Logs"
    echo ""

    if [ -f "$LOG_FILE" ]; then
        local date
        date=$(head -5 "$LOG_FILE" | grep "Date:" | sed 's/^.*Date: //')
        echo "  ${CYAN}verify-latest.log${NC} — ${date:-unknown}"
        echo "    File: ${LOG_FILE}"
        echo ""
    fi

    if [ -f "${LOG_FILE}.prev" ]; then
        local prev_date
        prev_date=$(head -5 "${LOG_FILE}.prev" | grep "Date:" | sed 's/^.*Date: //')
        echo "  ${CYAN}verify-latest.log.prev${NC} — ${prev_date:-unknown}"
        echo "    File: ${LOG_FILE}.prev"
        echo ""
    fi

    # Check for any archived logs
    local archived
    archived=$(find "$LOG_DIR" -name 'verify-*.log' -not -name 'verify-latest.log' 2>/dev/null | head -5)
    if [ -n "$archived" ]; then
        echo "  Archived logs:"
        echo "$archived" | while read -r f; do
            echo "    ${f}"
        done
    fi

    if [ ! -f "$LOG_FILE" ] && [ ! -f "${LOG_FILE}.prev" ]; then
        info "No verification logs found yet."
        info "Run 'bash scripts/verify.sh' to create the first log."
    fi
}

# ─── Check: TypeScript Type Checker ──────────────────────────────────────────
run_typecheck() {
    info "Running TypeScript type checker..."

    local start_time
    start_time=$(date +%s)

    cd "$PROJECT_DIR"

    # Capture both stdout and stderr
    local output
    output=$(npx tsc --noEmit 2>&1) || true
    local tsc_exit=$?

    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ "$tsc_exit" -eq 0 ]; then
        success "TypeScript type check PASSED (${duration}s)"
        log_result "TypeScript (tsc --noEmit)" "PASS" "$duration" ""
        return 0
    else
        error "TypeScript type check FAILED (${duration}s)"
        echo ""
        echo "$output" | head -30
        echo ""
        log_result "TypeScript (tsc --noEmit)" "FAIL" "$duration" "$(echo "$output" | head -20)"
        return 1
    fi
}

# ─── Check: Linter ───────────────────────────────────────────────────────────
run_lint() {
    info "Running linter..."

    local start_time
    start_time=$(date +%s)

    cd "$PROJECT_DIR"

    # Check if eslint is configured
    if [ ! -f ".eslintrc"* ] && [ ! -f "eslint.config"* ] && ! grep -q '"eslint"' package.json 2>/dev/null; then
        warn "No linter configuration found — skipping lint check"
        warn "Consider adding eslint or biome for automated linting"
        log_result "Linter" "SKIP" "0" "No linter configuration found"
        return 0
    fi

    local output
    output=$(npx eslint . --max-warnings=0 2>&1) || true
    local lint_exit=$?

    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ "$lint_exit" -eq 0 ]; then
        success "Linter PASSED (${duration}s)"
        log_result "Linter" "PASS" "$duration" ""
        return 0
    else
        error "Linter FAILED (${duration}s)"
        echo ""
        echo "$output" | head -30
        echo ""
        log_result "Linter" "FAIL" "$duration" "$(echo "$output" | head -20)"
        return 1
    fi
}

# ─── Check: Test Suite ───────────────────────────────────────────────────────
run_tests() {
    info "Running test suite (vitest)..."

    local start_time
    start_time=$(date +%s)

    cd "$PROJECT_DIR"

    local output
    output=$(npm test 2>&1) || true
    local test_exit=$?

    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ "$test_exit" -eq 0 ]; then
        success "Tests PASSED (${duration}s)"
        log_result "Tests (npm test)" "PASS" "$duration" ""
        return 0
    else
        error "Tests FAILED (${duration}s)"
        echo ""
        echo "$output" | tail -40
        echo ""
        log_result "Tests (npm test)" "FAIL" "$duration" "$(echo "$output" | tail -20)"
        return 1
    fi
}

# ─── Summary ─────────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    header "══════════════════════════════════════════════════════════════════════"

    if [ "$EXIT_CODE" -eq 0 ]; then
        success "All checks PASSED — task is ready to mark complete!"
    else
        local failed_checks=""
        [ $((EXIT_CODE & 1)) -ne 0 ] && failed_checks="${failed_checks} typecheck"
        [ $((EXIT_CODE & 2)) -ne 0 ] && failed_checks="${failed_checks} lint"
        [ $((EXIT_CODE & 4)) -ne 0 ] && failed_checks="${failed_checks} tests"
        error "Some checks FAILED:${failed_checks}"
        error "Fix the issues above, then re-run verification."
    fi

    echo "══════════════════════════════════════════════════════════════════════"

    if [ "$WRITE_LOG" = true ]; then
        local final_status
        [ "$EXIT_CODE" -eq 0 ] && final_status="PASS" || final_status="FAIL"
        echo "" >> "$LOG_FILE"
        echo "  Final Result: ${final_status}" >> "$LOG_FILE"
        echo "  Log saved to: ${LOG_FILE}" >> "$LOG_FILE"
    fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    # --list mode
    if [ "$LIST_MODE" = true ]; then
        list_logs
        exit 0
    fi

    # Initialize log
    init_log

    header "══════════════════════════════════════════════════════════════════════"
    header "  Verification Pipeline — Protocol Workflow Automation"
    header "══════════════════════════════════════════════════════════════════════"
    echo ""

    # Run selected checks
    if [ "$RUN_TYPECHECK" = true ]; then
        if ! run_typecheck; then
            EXIT_CODE=$((EXIT_CODE + 1))
        fi
        echo ""
    fi

    if [ "$RUN_LINT" = true ]; then
        if ! run_lint; then
            EXIT_CODE=$((EXIT_CODE + 2))
        fi
        echo ""
    fi

    if [ "$RUN_TEST" = true ]; then
        if ! run_tests; then
            EXIT_CODE=$((EXIT_CODE + 4))
        fi
        echo ""
    fi

    # Print summary
    print_summary

    exit $EXIT_CODE
}

main "$@"
