#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# dispatch-subagent.sh — Protocol Workflow: Subagent Dispatch Mechanism
#
# Spawns a focused subagent task for parallel investigation, research, or
# isolated sub-tasks. Collects output into a designated file under tasks/subagent/
# for later review.
#
# Usage:
#   bash scripts/dispatch-subagent.sh --task "description" [options]
#   bash scripts/dispatch-subagent.sh --list          # List completed subagent outputs
#   bash scripts/dispatch-subagent.sh --show <id>     # Show a specific subagent output
#   bash scripts/dispatch-subagent.sh --help          # Show this help
#
# Options:
#   --task "desc"     Task description for the subagent (required for dispatch)
#   --id "name"       Short identifier for the subagent task (default: auto-generated)
#   --output-dir dir  Output directory (default: tasks/subagent/)
#   --list            List all completed subagent outputs
#   --show <id>       Show a specific subagent output file
#   --quiet           Minimal output
#
# Exit codes:
#   0 — Subagent dispatched successfully (or --list/--show completed)
#   1 — No task provided
#   2 — Output directory creation failed
#   3 — Error
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
TASK_DESCRIPTION=""
TASK_ID=""
OUTPUT_DIR="${PROJECT_DIR}/tasks/subagent"
LIST_MODE=false
SHOW_MODE=""
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
        --id) TASK_ID="$2"; shift 2 ;;
        --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --list) LIST_MODE=true; shift ;;
        --show) SHOW_MODE="$2"; shift 2 ;;
        --quiet) QUIET=true; shift ;;
        --help|-h) head -30 "$0"; exit 0 ;;
        *) error "Unknown option: $1"; exit 3 ;;
    esac
done

# ─── Generate a short task ID from description ───────────────────────────────
generate_task_id() {
    local desc="$1"
    # Take first 3 words, lowercase, join with hyphens, strip non-alphanumeric
    echo "$desc" \
        | tr '[:upper:]' '[:lower:]' \
        | sed 's/[^a-z0-9 ]//g' \
        | awk '{for(i=1;i<=3&&i<=NF;i++) printf "%s%s", (i>1?"-":""), $i; print ""}' \
        | sed 's/ *$//'
}

# ─── List completed subagent outputs ─────────────────────────────────────────
list_outputs() {
    if [ ! -d "$OUTPUT_DIR" ]; then
        info "No subagent outputs yet — directory does not exist: $OUTPUT_DIR"
        exit 0
    fi

    local count
    count=$(find "$OUTPUT_DIR" -name '*.md' 2>/dev/null | wc -l)

    if [ "$count" -eq 0 ]; then
        info "No subagent outputs found in: $OUTPUT_DIR"
        exit 0
    fi

    header "Subagent Outputs ($count total)"
    echo ""

    for f in "$OUTPUT_DIR"/*.md; do
        local filename
        filename="$(basename "$f" .md)"
        local title
        title=$(head -1 "$f" 2>/dev/null | sed 's/^# //' || echo "untitled")
        local date
        date=$(stat -c '%y' "$f" 2>/dev/null | cut -d. -f1 || echo "unknown")
        echo "  ${CYAN}${filename}${NC}"
        echo "    Title: ${title}"
        echo "    Date:  ${date}"
        echo "    File:  ${f}"
        echo ""
    done
}

# ─── Show a specific subagent output ─────────────────────────────────────────
show_output() {
    local id="$1"
    local file="${OUTPUT_DIR}/${id}.md"

    if [ ! -f "$file" ]; then
        error "Subagent output not found: $file"
        error "Use --list to see available outputs"
        exit 1
    fi

    cat "$file"
}

# ─── Dispatch a subagent task ────────────────────────────────────────────────
dispatch() {
    local task="$1"
    local id="$2"
    local output_file="${OUTPUT_DIR}/${id}.md"

    # Ensure output directory exists
    if [ ! -d "$OUTPUT_DIR" ]; then
        mkdir -p "$OUTPUT_DIR"
        info "Created output directory: $OUTPUT_DIR"
    fi

    # Create the subagent output file with header
    cat > "$output_file" <<SUBAGENTHEADER
# Subagent Task: ${task}

**ID:** ${id}
**Dispatched:** $(date '+%Y-%m-%d %H:%M:%S')
**Status:** Dispatched

## Task Description
${task}

## Instructions
This subagent should:
1. Research/explore the task independently
2. Document findings below
3. Keep output focused and actionable

## Findings
<!-- Subagent fills this in -->

## Conclusion
<!-- Summary of findings and recommendations -->

SUBAGENTHEADER

    success "Subagent dispatched: ${id}"
    info "Task: ${task}"
    info "Output will be written to: ${output_file}"
    info ""
    info "To run this subagent, use the subagent_tool with:"
    info "  Task: ${task}"
    info ""
    info "After completion, review the output at: ${output_file}"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    header "══════════════════════════════════════════════════════════════════════"
    header "  Subagent Dispatch — Protocol Workflow Automation"
    header "══════════════════════════════════════════════════════════════════════"
    echo ""

    # --list mode
    if [ "$LIST_MODE" = true ]; then
        list_outputs
        exit 0
    fi

    # --show mode
    if [ -n "$SHOW_MODE" ]; then
        show_output "$SHOW_MODE"
        exit 0
    fi

    # Dispatch mode
    if [ -z "$TASK_DESCRIPTION" ]; then
        error "No task description provided. Use --task \"description\""
        error "Or use --list to see completed outputs"
        exit 1
    fi

    # Auto-generate ID if not provided
    if [ -z "$TASK_ID" ]; then
        TASK_ID=$(generate_task_id "$TASK_DESCRIPTION")
        # Add timestamp suffix to avoid collisions
        TASK_ID="${TASK_ID}-$(date '+%H%M%S')"
    fi

    dispatch "$TASK_DESCRIPTION" "$TASK_ID"
}

main "$@"
