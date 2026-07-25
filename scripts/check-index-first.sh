#!/bin/bash
# =============================================================================
# check-index-first.sh — CI gate for index-first pattern enforcement
#
# Scans TypeScript source files for naive full-scan patterns that bypass the
# index-first resolution protocol. Fails (exit 1) if any call site introduces
# a recursive directory walk or glob scan without first consulting getIndex().
#
# Usage:
#   bash scripts/check-index-first.sh          # scan all src/ files
#   bash scripts/check-index-first.sh --diff    # scan only changed files (git diff)
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}[index-first check] Scanning for naive scan patterns...${NC}"

# Determine which files to scan
if [ "${1:-}" = "--diff" ]; then
  FILES=$(git diff --name-only --diff-filter=ACMRT HEAD 2>/dev/null || git diff --name-only --cached 2>/dev/null || echo "")
  if [ -z "$FILES" ]; then
    echo -e "${GREEN}[index-first check] No changed files to scan.${NC}"
    exit 0
  fi
  # Filter to .ts files in src/
  FILES=$(echo "$FILES" | grep -E '^src/.*\.ts$' || true)
  if [ -z "$FILES" ]; then
    echo -e "${GREEN}[index-first check] No changed .ts files in src/ to scan.${NC}"
    exit 0
  fi
else
  FILES=$(find src/ -name '*.ts' -not -path '*/node_modules/*' -not -path '*/__tests__/*' 2>/dev/null || true)
fi

EXIT_CODE=0

# Pattern 1: Direct globTool("**/*" or globTool("**/*.* without getIndex() guard
# We look for lines that call globTool with a recursive pattern and check if
# the function containing it has a getIndex() call before it.
#
# Since static analysis of function boundaries is complex, we use a simpler
# heuristic: any file that uses globTool("**/*" or globTool('**/*' must also
# import or call getIndex somewhere in the same file.

check_file() {
  local file="$1"
  local basename
  basename=$(basename "$file")

  # Skip test files and type definition files
  if [[ "$basename" == *".test."* ]] || [[ "$basename" == *".d.ts" ]]; then
    return 0
  fi

  local has_naive_scan=false
  local has_index_first=false

  # Check for naive recursive glob patterns
  if grep -nE 'globTool\s*\(\s*["'\'']\*\*/\*' "$file" > /dev/null 2>&1; then
    has_naive_scan=true
  fi

  # Check for naive fs.readdirSync + recursive walk patterns
  if grep -nE 'readdirSync\s*\(.*\)\s*\.\s*(filter|map|forEach|flatMap)' "$file" > /dev/null 2>&1; then
    has_naive_scan=true
  fi

  # Check for getIndex() import or call
  if grep -nE 'getIndex' "$file" > /dev/null 2>&1; then
    has_index_first=true
  fi

  # Check for import from indexing module
  if grep -nE 'from\s+["'\'']\.\./indexing/|from\s+["'\'']\.\./indexingTool|from\s+["'\'']\.\./tools/indexingTool' "$file" > /dev/null 2>&1; then
    has_index_first=true
  fi

  if [ "$has_naive_scan" = true ] && [ "$has_index_first" = false ]; then
    echo -e "${RED}FAIL: $file${NC}"
    echo -e "${RED}  -> Uses recursive glob/scan pattern without getIndex() guard${NC}"
    grep -nE 'globTool\s*\(\s*["'\'']\*\*/\*|readdirSync\s*\(' "$file" | while read -r line; do
      echo -e "${RED}     $line${NC}"
    done
    EXIT_CODE=1
  fi
}

if [ -z "$FILES" ]; then
  echo -e "${GREEN}[index-first check] No files to scan.${NC}"
  exit 0
fi

for file in $FILES; do
  if [ -f "$file" ]; then
    check_file "$file"
  fi
done

if [ "$EXIT_CODE" -eq 0 ]; then
  echo -e "${GREEN}[index-first check] All files use index-first pattern. ✓${NC}"
else
  echo ""
  echo -e "${RED}[index-first check] FAILED: Some files use naive scans without getIndex().${NC}"
  echo -e "${YELLOW}  Fix: Add 'import { getIndex } from \"../indexing/indexer.js\"' and call getIndex()${NC}"
  echo -e "${YELLOW}  before any recursive glob or directory walk.${NC}"
fi

exit "$EXIT_CODE"
