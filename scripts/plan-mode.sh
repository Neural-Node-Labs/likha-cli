#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# plan-mode.sh — Protocol Workflow: Enter Plan Mode
#
# Determines whether a task is "non-trivial" (3+ steps or architectural
# decisions) and, if so, enters plan mode by opening/creating a plan file
# in tasks/ for the user to fill in.
#
# Usage:
#   bash scripts/plan-mode.sh [--task "description"] [--plan-file path]
#   bash scripts/plan-mode.sh --check          # Just check complexity, exit 0/1
#   bash scripts/plan-mode.sh --help           # Show this help
#
# Options:
#   --task "desc"     Task description to analyze for complexity
#   --plan-file path  Plan file to create/open (default: tasks/todo.md)
#   --check           Only check if plan mode is needed (exit 0=yes, 1=no)
#   --force           Force plan mode regardless of complexity
#   --quiet           Minimal output
#
# Exit codes:
#   0 — Plan mode entered (or --check: plan needed)
#   1 — No plan needed (trivial task)
#   2 — Plan file already exists and is non-empty
#   3 — Error
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
TASK_DESCRIPTION=""
PLAN_FILE="${PROJECT_DIR}/tasks/todo.md"
CHECK_MODE=false
FORCE_MODE=false
QUIET=false

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
        --task) TASK_DESCRIPTION="$2"; shift 2 ;;
        --plan-file) PLAN_FILE="$2"; shift 2 ;;
        --check) CHECK_MODE=true; shift ;;
        --force) FORCE_MODE=true; shift ;;
        --quiet) QUIET=true; shift ;;
        --help|-h) head -30 "$0"; exit 0 ;;
        *) error "Unknown option: $1"; exit 3 ;;
    esac
done

# ─── Complexity Analysis ─────────────────────────────────────────────────────
# Heuristics to determine if a task is non-trivial:
#   1. Task description mentions multiple steps (numbered list, "steps", "phases")
#   2. Task description mentions architectural decisions ("architect", "design", "schema")
#   3. Task description mentions multiple files or components
#   4. Task description is long (>100 chars suggests complexity)
#   5. Task description contains keywords like "migrate", "refactor", "implement"

is_non_trivial() {
    local desc="$1"

    # Force mode always returns true
    if [ "$FORCE_MODE" = true ]; then
        return 0
    fi

    # Empty description — assume non-trivial (need to investigate)
    if [ -z "$desc" ]; then
        return 0
    fi

    # Count indicators of complexity
    local complexity_score=0

    # Check for multi-step indicators
    if echo "$desc" | grep -qiE '(steps?|phases?|stages?|parts?)'; then
        complexity_score=$((complexity_score + 1))
    fi

    # Check for architectural keywords
    if echo "$desc" | grep -qiE '(architect|design|schema|pattern|strategy|infrastructure)'; then
        complexity_score=$((complexity_score + 1))
    fi

    # Check for multi-file/component indicators
    if echo "$desc" | grep -qiE '(multiple|several|various|all|every|each)'; then
        complexity_score=$((complexity_score + 1))
    fi

    # Check for implementation keywords
    if echo "$desc" | grep -qiE '(implement|migrate|refactor|redesign|restructure|rewrite)'; then
        complexity_score=$((complexity_score + 1))
    fi

    # Check for cross-cutting concerns
    if echo "$desc" | grep -qiE '(integrat|deploy|pipeline|configur|database|network|security)'; then
        complexity_score=$((complexity_score + 1))
    fi

    # Long descriptions suggest complexity
    if [ ${#desc} -gt 100 ]; then
        complexity_score=$((complexity_score + 1))
    fi

    # Score >= 2 is non-trivial
    [ "$complexity_score" -ge 2 ]
}

# ─── Plan Mode Entry ─────────────────────────────────────────────────────────
enter_plan_mode() {
    local plan_file="$1"
    local plan_dir
    plan_dir="$(dirname "$plan_file")"

    # Ensure tasks/ directory exists
    if [ ! -d "$plan_dir" ]; then
        mkdir -p "$plan_dir"
        info "Created directory: $plan_dir"
    fi

    # Check if plan file already exists and is non-empty
    if [ -f "$plan_file" ] && [ -s "$plan_file" ]; then
        warn "Plan file already exists: $plan_file"
        warn "Open it in your editor to continue working on the existing plan."
        return 2
    fi

    # Create a new plan file with template
    cat > "$plan_file" <<PLANTEMPLATE
# Plan: ${TASK_DESCRIPTION:-Untitled Task}

**Date:** $(date +%Y-%m-%d)
**Status:** Draft

## Objective
<!-- What are we trying to achieve? -->

## Requirements
<!-- List functional and non-functional requirements -->

## Approach
<!-- High-level approach / architecture decisions -->

## Tasks
<!-- Checkable items — mark [x] when complete -->
- [ ] Task 1: <!-- description -->
- [ ] Task 2: <!-- description -->
- [ ] Task 3: <!-- description -->

## Verification
<!-- How will we know this is done? -->
- [ ] Tests pass
- [ ] Type checker passes
- [ ] Manual verification steps

## Review
<!-- To be filled after completion -->
**Result:**
**Issues encountered:**
**Lessons learned:**
PLANTEMPLATE

    success "Plan mode entered — created: $plan_file"
    info "Fill in the plan template, then start implementing."
    info "Run 'bash scripts/verify.sh' before marking tasks complete."
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    header "══════════════════════════════════════════════════════════════════════"
    header "  Plan Mode — Protocol Workflow Automation"
    header "══════════════════════════════════════════════════════════════════════"
    echo ""

    # --check mode: just determine if plan is needed
    if [ "$CHECK_MODE" = true ]; then
        if is_non_trivial "$TASK_DESCRIPTION"; then
            info "Task is non-trivial — plan mode recommended"
            exit 0
        else
            info "Task is trivial — no plan needed"
            exit 1
        fi
    fi

    # Determine if plan mode is needed
    if ! is_non_trivial "$TASK_DESCRIPTION"; then
        info "Task appears trivial — skipping plan mode"
        info "Use --force to override"
        exit 1
    fi

    # Enter plan mode
    enter_plan_mode "$PLAN_FILE"
    local exit_code=$?

    echo ""
    if [ "$exit_code" -eq 0 ]; then
        success "Plan mode setup complete"
    elif [ "$exit_code" -eq 2 ]; then
        warn "Plan file already exists — continuing with existing plan"
    fi

    exit $exit_code
}

main "$@"
