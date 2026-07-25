#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# capture-lesson.sh — Protocol Workflow: Lesson Capture Hook
#
# Prompts for a lesson learned after a correction, then appends a formatted
# entry to tasks/lessons.md with a timestamp.
#
# Usage:
#   bash scripts/capture-lesson.sh                    # Interactive mode (prompts)
#   bash scripts/capture-lesson.sh --title "..." \    # Non-interactive mode
#     --context "..." \
#     --fix "..." \
#     --pattern "..."
#   bash scripts/capture-lesson.sh --list             # List recent lessons
#   bash scripts/capture-lesson.sh --help             # Show this help
#
# Options:
#   --title "str"     Lesson title (required for non-interactive)
#   --context "str"   Context/background of the issue
#   --fix "str"       What the fix was
#   --pattern "str"   The pattern to follow in the future
#   --file path       Lessons file path (default: tasks/lessons.md)
#   --list            List recent lessons with dates
#   --quiet           Minimal output
#
# Exit codes:
#   0 — Lesson captured successfully
#   1 — No title provided (interactive cancelled)
#   2 — Lessons file not writable
#   3 — Error
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
LESSONS_FILE="${PROJECT_DIR}/tasks/lessons.md"
TITLE=""
CONTEXT=""
FIX=""
PATTERN=""
LIST_MODE=false
QUIET=false
INTERACTIVE=true

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
prompt()  { echo -e "${CYAN}>>>${NC} $*"; }

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --title) TITLE="$2"; INTERACTIVE=false; shift 2 ;;
        --context) CONTEXT="$2"; shift 2 ;;
        --fix) FIX="$2"; shift 2 ;;
        --pattern) PATTERN="$2"; shift 2 ;;
        --file) LESSONS_FILE="$2"; shift 2 ;;
        --list) LIST_MODE=true; shift ;;
        --quiet) QUIET=true; shift ;;
        --help|-h) head -30 "$0"; exit 0 ;;
        *) error "Unknown option: $1"; exit 3 ;;
    esac
done

# ─── List recent lessons ─────────────────────────────────────────────────────
list_lessons() {
    if [ ! -f "$LESSONS_FILE" ]; then
        info "No lessons file found at: $LESSONS_FILE"
        exit 0
    fi

    header "Recent Lessons Learned"
    echo ""

    local in_lesson=false
    local current_title=""
    local current_date=""

    while IFS= read -r line; do
        # Match date headers like "## 2026-07-21"
        if echo "$line" | grep -qE '^## [0-9]{4}-[0-9]{2}-[0-9]{2}'; then
            current_date=$(echo "$line" | sed 's/^## //')
            continue
        fi

        # Match lesson titles like "### Always ..."
        if echo "$line" | grep -qE '^### '; then
            current_title=$(echo "$line" | sed 's/^### //')
            echo "  ${CYAN}${current_date}${NC} — ${current_title}"
            in_lesson=true
            continue
        fi
    done < "$LESSONS_FILE"

    if [ "$in_lesson" = false ]; then
        info "No lessons found in: $LESSONS_FILE"
    fi
}

# ─── Interactive prompts ─────────────────────────────────────────────────────
prompt_for_lesson() {
    echo ""
    header "─── Capture a Lesson Learned ───"
    echo ""
    info "A correction was made. Let's capture the lesson so it doesn't happen again."
    echo ""

    # Title
    prompt "What is the lesson title? (e.g., 'Always guard nullable return values before destructuring')"
    read -r TITLE
    if [ -z "$TITLE" ]; then
        warn "No title provided — lesson not captured"
        exit 1
    fi

    # Context
    echo ""
    prompt "What was the context? (Where did this happen? What file/component?)"
    read -r CONTEXT

    # Fix
    echo ""
    prompt "What was the fix? (What code change resolved it?)"
    read -r FIX

    # Pattern
    echo ""
    prompt "What pattern should we follow in the future? (How to prevent this?)"
    read -r PATTERN

    echo ""
}

# ─── Append lesson to lessons file ───────────────────────────────────────────
append_lesson() {
    local title="$1"
    local context="$2"
    local fix="$3"
    local pattern="$4"
    local date
    date=$(date '+%Y-%m-%d')

    # Ensure the directory exists
    local lessons_dir
    lessons_dir="$(dirname "$LESSONS_FILE")"
    if [ ! -d "$lessons_dir" ]; then
        mkdir -p "$lessons_dir"
        info "Created directory: $lessons_dir"
    fi

    # Create file with header if it doesn't exist
    if [ ! -f "$LESSONS_FILE" ]; then
        cat > "$LESSONS_FILE" <<HEADER
# Lessons Learned

HEADER
        info "Created new lessons file: $LESSONS_FILE"
    fi

    # Check if a date section for today already exists
    local has_date_section=false
    if grep -qE "^## ${date}$" "$LESSONS_FILE" 2>/dev/null; then
        has_date_section=true
    fi

    # Build the lesson entry
    local lesson_entry=""

    if [ "$has_date_section" = false ]; then
        lesson_entry+="\n## ${date}\n"
    fi

    lesson_entry+="\n### ${title}\n"
    lesson_entry+="\n**Context:** ${context}\n"

    if [ -n "$fix" ]; then
        lesson_entry+="\n**Fix:** ${fix}\n"
    fi

    if [ -n "$pattern" ]; then
        lesson_entry+="\n**Pattern:** ${pattern}\n"
    fi

    # Append to file
    echo -e "$lesson_entry" >> "$LESSONS_FILE"

    success "Lesson captured in: ${LESSONS_FILE}"
    info "Title: ${title}"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    header "══════════════════════════════════════════════════════════════════════"
    header "  Lesson Capture — Protocol Workflow Automation"
    header "══════════════════════════════════════════════════════════════════════"

    # --list mode
    if [ "$LIST_MODE" = true ]; then
        list_lessons
        exit 0
    fi

    # Interactive mode
    if [ "$INTERACTIVE" = true ]; then
        prompt_for_lesson
    fi

    # Validate title
    if [ -z "$TITLE" ]; then
        error "No title provided. Use --title or run interactively."
        exit 1
    fi

    # Validate lessons file is writable
    local lessons_dir
    lessons_dir="$(dirname "$LESSONS_FILE")"
    if [ -d "$lessons_dir" ] && [ ! -w "$lessons_dir" ]; then
        error "Directory not writable: $lessons_dir"
        exit 2
    fi
    if [ -f "$LESSONS_FILE" ] && [ ! -w "$LESSONS_FILE" ]; then
        error "File not writable: $LESSONS_FILE"
        exit 2
    fi

    # Append the lesson
    append_lesson "$TITLE" "$CONTEXT" "$FIX" "$PATTERN"

    echo ""
    success "Lesson capture complete"
    info "Run 'bash scripts/capture-lesson.sh --list' to see all lessons"
}

main "$@"
