#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# create-deploy-tarball.sh
#
# Creates a deploy tarball (devnull-deploy.tar.gz) containing everything needed
# to build and run the devnull stack on a remote Docker host.
#
# Includes:
#   - dist/          (compiled JS artifacts)
#   - Dockerfile     (multi-stage build)
#   - docker-compose.yml
#   - .dockerignore
#   - .env.example   (NOT .env — secrets excluded)
#   - package.json, package-lock.json, tsconfig.json
#   - agent/         (skills, protocol, config)
#   - ui/            (frontend — built separately in its own Dockerfile)
#
# Excludes:
#   - .env, .env.local, .env.production  (secrets)
#   - node_modules/  (installed during Docker build)
#   - .git/          (version control)
#   - .log/          (runtime data)
#   - .agent/index/  (generated index)
#   - tasks/, reports/, coverage/
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="${1:-${PROJECT_DIR}/devnull-deploy.tar.gz}"

echo "📦 Creating deploy tarball..."
echo "   Project: $PROJECT_DIR"
echo "   Output:  $OUTPUT_FILE"
echo ""

cd "$PROJECT_DIR"

# Build the file list using git ls-files if available (respects .gitignore),
# otherwise fall back to a curated list.
if command -v git &>/dev/null && [ -d .git ]; then
  echo "   Using git ls-files for file list..."
  FILES=$(git ls-files --cached --others --exclude-standard | grep -v -E '^\.env$|^\.env\.local$|^\.env\.production$')
else
  echo "   Using curated file list..."
  # Curated list of files/directories to include
  FILES=$(cat <<'EOF'
dist/
Dockerfile
docker-compose.yml
.dockerignore
.env.example
package.json
package-lock.json
tsconfig.json
agent/
ui/
EOF
)
fi

# Create the tarball
echo ""
echo "   Creating tarball..."
tar -czf "$OUTPUT_FILE" \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.production' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.log' \
  --exclude='.agent/index' \
  --exclude='tasks' \
  --exclude='reports' \
  --exclude='coverage' \
  --exclude='*.dump' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  --exclude='npm-debug.log' \
  --exclude='yarn-debug.log' \
  --exclude='yarn-error.log' \
  --exclude='.vscode' \
  --exclude='.idea' \
  --exclude='*.swp' \
  --exclude='*.swo' \
  --exclude='tsconfig.tsbuildinfo' \
  dist/ \
  Dockerfile \
  docker-compose.yml \
  .dockerignore \
  .env.example \
  package.json \
  package-lock.json \
  tsconfig.json \
  agent/ \
  ui/

echo ""
echo "✅ Tarball created: $OUTPUT_FILE"
echo "   Size: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo ""

# ── Validation ───────────────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════════════════════════════"
echo "  Validating tarball contents..."
echo "══════════════════════════════════════════════════════════════════════════"
echo ""

# List contents
tar -tzf "$OUTPUT_FILE" | sort > /tmp/devnull-tarball-contents.txt

echo "Files in tarball:"
echo "-----------------"
cat /tmp/devnull-tarball-contents.txt
echo ""

# Check required files exist
MISSING=0
check_file() {
  if grep -q "^$1" /tmp/devnull-tarball-contents.txt; then
    echo "  ✅ $1"
  else
    echo "  ❌ $1 — MISSING!"
    MISSING=1
  fi
}

echo "Required file check:"
echo "--------------------"
check_file "dist/"
check_file "Dockerfile"
check_file "docker-compose.yml"
check_file ".dockerignore"
check_file ".env.example"
check_file "package.json"
check_file "package-lock.json"
check_file "tsconfig.json"
check_file "agent/"
check_file "ui/"

# Verify .env is NOT in the tarball
if grep -q "^\.env$" /tmp/devnull-tarball-contents.txt; then
  echo ""
  echo "  ❌ SECURITY RISK: .env file found in tarball!"
  MISSING=1
else
  echo ""
  echo "  ✅ .env correctly excluded (secrets safe)"
fi

echo ""
if [ "$MISSING" -eq 0 ]; then
  echo "✅ All required files present. Tarball is valid."
else
  echo "❌ Some required files are missing from the tarball."
  exit 1
fi

# Cleanup
rm -f /tmp/devnull-tarball-contents.txt
