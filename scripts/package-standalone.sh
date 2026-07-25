#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# package-standalone.sh — Build the standalone (non-Docker) deployment package
#
# Creates a self-contained directory `devnull-standalone/` with everything needed
# to run devnull without Docker:
#   - Compiled JavaScript (dist/)
#   - Production npm dependencies (node_modules/)
#   - Agent skills, protocol, and config (agent/)
#   - SQLite migration files (migrations/)
#   - Launcher script (devnull-server.sh)
#   - .env.example for configuration
#   - README with install/run instructions
#
# Also produces a tarball: devnull-standalone.tar.gz
#
# Usage:
#   ./scripts/package-standalone.sh              # Build the package
#   ./scripts/package-standalone.sh --no-tarball  # Skip tarball creation
#   ./scripts/package-standalone.sh --output DIR  # Custom output directory
#   ./scripts/package-standalone.sh --help        # Show help
#
# Prerequisites:
#   - Node.js 20+
#   - npm
#   - TypeScript compiled (npm run build)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
OUTPUT_DIR="${PROJECT_DIR}/devnull-standalone"
CREATE_TARBALL=true

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ─── Help ────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Build the standalone (non-Docker) deployment package.

Options:
  --no-tarball      Skip tarball creation (keep only the directory)
  --output DIR      Custom output directory (default: devnull-standalone/)
  --help            Show this help message

The package includes:
  - dist/              Compiled JavaScript
  - node_modules/      Production npm dependencies
  - agent/             Skills, protocol, and config
  - migrations/        SQLite migration files
  - devnull-server.sh  Launcher script
  - .env.example       Configuration template
  - package.json       Package manifest
  - README.md          Install/run instructions

Prerequisites:
  - Node.js 20+
  - npm
  - Run 'npm run build' first (or this script will do it)

Examples:
  ./scripts/package-standalone.sh
  ./scripts/package-standalone.sh --no-tarball
  ./scripts/package-standalone.sh --output /tmp/devnull-pkg
EOF
  exit 0
}

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-tarball)
      CREATE_TARBALL=false
      shift
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      ;;
    *)
      error "Unknown option: $1"
      echo "Usage: $(basename "$0") [--no-tarball] [--output DIR] [--help]"
      exit 1
      ;;
  esac
done

# ─── Step 1: Build TypeScript ────────────────────────────────────────────────
step_build() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 1: Build TypeScript"
  echo "══════════════════════════════════════════════════════════════════════"

  cd "$PROJECT_DIR"

  if [ -f "dist/cli/index.js" ]; then
    info "dist/ already exists — checking if rebuild is needed..."
    # Rebuild if source is newer than dist
    if find src/ -newer dist/cli/index.js -name '*.ts' 2>/dev/null | grep -q .; then
      info "Source files changed — rebuilding..."
      npm run build
    else
      info "dist/ is up to date"
    fi
  else
    info "Building TypeScript..."
    npm run build
  fi

  if [ ! -f "dist/cli/index.js" ]; then
    error "Build failed — dist/cli/index.js not found"
    exit 1
  fi

  success "TypeScript compilation complete"
}

# ─── Step 2: Install production dependencies ─────────────────────────────────
step_deps() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 2: Install Production Dependencies"
  echo "══════════════════════════════════════════════════════════════════════"

  cd "$PROJECT_DIR"

  if [ -d "node_modules" ]; then
    info "node_modules/ exists — verifying..."
    # Check that key production deps are present
    if [ -d "node_modules/express" ] && [ -d "node_modules/better-sqlite3" ]; then
      info "Production dependencies already installed"
    else
      info "Reinstalling production dependencies..."
      npm install --omit=dev --no-audit --no-fund
    fi
  else
    info "Installing production dependencies..."
    npm install --omit=dev --no-audit --no-fund
  fi

  success "Production dependencies installed"
}

# ─── Step 3: Create output directory ─────────────────────────────────────────
step_create_output() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 3: Create Package Directory"
  echo "══════════════════════════════════════════════════════════════════════"

  info "Output directory: ${OUTPUT_DIR}"

  # Clean previous output
  if [ -d "$OUTPUT_DIR" ]; then
    info "Cleaning previous output..."
    rm -rf "$OUTPUT_DIR"
  fi

  # Create directory structure
  mkdir -p "${OUTPUT_DIR}/dist"
  mkdir -p "${OUTPUT_DIR}/agent/config"
  mkdir -p "${OUTPUT_DIR}/agent/skills"
  mkdir -p "${OUTPUT_DIR}/migrations/sqlite"
  mkdir -p "${OUTPUT_DIR}/.log"
  mkdir -p "${OUTPUT_DIR}/.agent/index"

  success "Directory structure created"
}

# ─── Step 4: Copy files ──────────────────────────────────────────────────────
step_copy() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 4: Copy Files"
  echo "══════════════════════════════════════════════════════════════════════"

  cd "$PROJECT_DIR"

  # 4a. Compiled JavaScript
  info "Copying dist/ (compiled JS)..."
  cp -r dist/* "${OUTPUT_DIR}/dist/"
  success "dist/ copied ($(find dist/ -name '*.js' | wc -l) JS files)"

  # 4b. Production node_modules
  info "Copying node_modules/ (production only)..."
  # Use npm prune to ensure only production deps are present
  cp -r node_modules "${OUTPUT_DIR}/node_modules"
  success "node_modules/ copied"

  # 4c. Agent skills and config
  info "Copying agent/ (skills, protocol, config)..."
  cp -r agent/* "${OUTPUT_DIR}/agent/"
  success "agent/ copied"

  # 4d. SQLite migrations
  info "Copying migrations/..."
  cp -r migrations/sqlite/* "${OUTPUT_DIR}/migrations/sqlite/"
  success "migrations/ copied"

  # 4e. Package manifests
  info "Copying package manifests..."
  cp package.json "${OUTPUT_DIR}/package.json"
  if [ -f package-lock.json ]; then
    cp package-lock.json "${OUTPUT_DIR}/package-lock.json"
  fi
  cp tsconfig.json "${OUTPUT_DIR}/tsconfig.json"
  success "Package manifests copied"

  # 4f. .env.example
  info "Copying .env.example..."
  if [ -f .env.example ]; then
    cp .env.example "${OUTPUT_DIR}/.env.example"
  fi
  success ".env.example copied"

  # 4g. Launcher script
  info "Copying launcher script..."
  cp scripts/devnull-server.sh "${OUTPUT_DIR}/devnull-server.sh"
  success "devnull-server.sh copied"

  # 4h. README (will be written separately)
  info "README will be written in the next step"

  echo ""
  success "All files copied"
}

# ─── Step 5: Write standalone README ─────────────────────────────────────────
step_readme() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 5: Write Standalone README"
  echo "══════════════════════════════════════════════════════════════════════"

  cat > "${OUTPUT_DIR}/README.md" << 'READMEEOF'
# devnull — Standalone Package (No Docker Required)

A self-contained deployment of the devnull ReAct CLI agent with HTTP API server.
Everything you need to run devnull without Docker.

## What's Included

```
devnull-standalone/
├── dist/                  # Compiled JavaScript
├── node_modules/          # Production npm dependencies
├── agent/
│   ├── devnull.md         # Engineering protocol
│   ├── config/llm.yaml    # LLM configuration
│   └── skills/            # 13 hot-plug skills
├── migrations/sqlite/     # SQLite database migrations
├── .env.example           # Configuration template
├── devnull-server.sh      # Launcher script
├── package.json           # Package manifest
└── README.md              # This file
```

## Prerequisites

- **Node.js 20+** (LTS recommended) — [Download](https://nodejs.org/)
- **npm** (ships with Node.js)
- **DeepSeek API key** (required for LLM features) — [Get one here](https://platform.deepseek.com/)

No Docker required. No PostgreSQL required. SQLite is built-in.

## Quick Start

### 1. Extract the package

```bash
# If you received a tarball:
tar -xzf devnull-standalone.tar.gz
cd devnull-standalone
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your DEEPSEEK_API_KEY
```

### 3. Start the server

```bash
./devnull-server.sh
```

The server starts on `http://localhost:3001` by default.

### 4. Verify it's running

```bash
curl http://localhost:3001/api/v1/health
```

Expected response:
```json
{"success":true,"data":{"status":"ok","version":"0.2.0","uptime":"..."}}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DEEPSEEK_API_KEY` | (required) | DeepSeek API key for LLM access |
| `DEVNULL_API_PORT` | `3001` | API server port |
| `DEVNULL_API_HOST` | `0.0.0.0` | API server bind address |
| `DEVNULL_HOME` | (package dir) | Runtime home directory |
| `NODE_ENV` | `production` | Runtime environment |
| `DATABASE_TYPE` | `sqlite` | Database backend (`sqlite` or `postgres`) |
| `DATABASE_SQLITE_PATH` | `~/.devnull/data/devnull.db` | Custom SQLite file path |

Set these in your `.env` file or as environment variables.

### Custom Port

```bash
# Via environment variable
DEVNULL_API_PORT=8080 ./devnull-server.sh

# Via command-line argument
./devnull-server.sh --port 8080

# Custom host and port
./devnull-server.sh --port 8080 --host 127.0.0.1
```

## Using the API

### Login (first user becomes admin)

```bash
curl -X POST http://localhost:3001/api/v1/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}'
```

### Chat with the agent

```bash
TOKEN="your-auth-token-from-login"

curl -X POST http://localhost:3001/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task": "list files in the workspace"}'
```

### Check available skills

```bash
curl http://localhost:3001/api/v1/skills \
  -H "Authorization: Bearer $TOKEN"
```

## Stopping the Server

Press **Ctrl+C** in the terminal where the server is running.

The server handles SIGTERM and SIGINT for graceful shutdown — active requests
will complete before the process exits.

## Database

By default, devnull uses **SQLite** — a file-based database that requires no
separate process. The database file is created at `~/.devnull/data/devnull.db`
on first run.

### Using PostgreSQL instead

If you prefer PostgreSQL, set these in your `.env`:

```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/devnull
```

## Logs

Log files are written to the `.log/` directory in the package root:

- `thinking.log` — ReAct loop reasoning traces
- `llm.log` — LLM API call logs
- `sys.log` — System-level events and errors

## Troubleshooting

### "Node.js not found"
Install Node.js 20+ from https://nodejs.org/

### "dist/cli/index.js not found"
The package may be incomplete. Re-run the packaging script:
```bash
cd /path/to/devnull/source
./scripts/package-standalone.sh
```

### "node_modules not found"
Production dependencies are missing. Install them:
```bash
cd /path/to/devnull-standalone
npm install --omit=dev --no-audit --no-fund
```

### "DEEPSEEK_API_KEY not set"
Copy `.env.example` to `.env` and add your DeepSeek API key:
```bash
cp .env.example .env
# Edit .env and add DEEPSEEK_API_KEY=your_key_here
```

### Port already in use
Change the port:
```bash
DEVNULL_API_PORT=8080 ./devnull-server.sh
```

### Server won't start
Check the logs in `.log/sys.log` for error details.

## CLI Mode (One-off Tasks)

You can also use devnull in CLI mode without starting the server:

```bash
# List all loaded skills
node dist/cli/index.js --skills

# Index the current workspace
node dist/cli/index.js --index

# Run a single task
node dist/cli/index.js --task "your task description"

# Interactive chat mode
node dist/cli/index.js --chat
```

## Upgrading

1. Download the new package
2. Stop the server (Ctrl+C)
3. Backup your `.env` file
4. Extract the new package over the old one
5. Restore your `.env` file
6. Start the server again

## License

MIT
READMEEOF

  success "README.md written"
}

# ─── Step 6: Create tarball ──────────────────────────────────────────────────
step_tarball() {
  if [ "$CREATE_TARBALL" = false ]; then
    info "Skipping tarball creation (--no-tarball)"
    return
  fi

  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 6: Create Tarball"
  echo "══════════════════════════════════════════════════════════════════════"

  cd "$PROJECT_DIR"

  local tarball_name="devnull-standalone.tar.gz"
  info "Creating ${tarball_name}..."

  # Use tar to create the archive
  tar -czf "${tarball_name}" \
    --exclude="node_modules/.cache" \
    --exclude=".git" \
    --exclude=".log" \
    --exclude=".agent/index" \
    -C "$(dirname "${OUTPUT_DIR}")" \
    "$(basename "${OUTPUT_DIR}")"

  local size
  size=$(du -h "${tarball_name}" | cut -f1)
  success "Tarball created: ${tarball_name} (${size})"
}

# ─── Step 7: Validate package ────────────────────────────────────────────────
step_validate() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Step 7: Validate Package"
    echo "  Step 7: Validate Package"
  echo "════════════════════════════════"

  local errors=0

  # Required files/directories
  local required_paths=(
    "dist/cli/index.js:CLI entry point"
    "dist/api/server.js:API server module"
    "dist/core/orchestrator.js:Orchestrator module"
    "dist/tools/toolDispatcher.js:Tool dispatcher"
    "node_modules:node_modules/ (production deps)"
    "agent/devnull.md:Engineering protocol"
    "agent/config/llm.yaml:LLM config"
    "agent/skills:Skills directory"
    "migrations/sqlite:SQLite migrations"
    "devnull-server.sh:Launcher script"
    "package.json:Package manifest"
    ".env.example:Environment template"
    "README.md:README"
  )

  for entry in "${required_paths[@]}"; do
    local path="${entry%%:*}"
    local label="${entry#*:}"
    local full_path="${OUTPUT_DIR}/${path}"

    if [ -e "$full_path" ]; then
      success "  ${label}: ${path}"
    else
      error "  ${label}: ${path} - MISSING!"
      errors=$((errors + 1))
    fi
  done

  # Check skill count
  local skills_dir="${OUTPUT_DIR}/agent/skills"
  if [ -d "$skills_dir" ]; then
    local skill_count=0
    for d in "$skills_dir"/*/; do
      if [ -d "$d" ]; then
        skill_count=$((skill_count + 1))
      fi
    done
    success "  Skills: ${skill_count} skill directories"
  fi

  # Check dist JS file count
  local dist_dir="${OUTPUT_DIR}/dist"
  if [ -d "$dist_dir" ]; then
    local js_count
    js_count=$(find "$dist_dir" -name '*.js' | wc -l)
    success "  Compiled JS: ${js_count} files in dist/"
  fi

  # Verify no .ts files leaked (excluding node_modules)
  local ts_count
  ts_count=$(find "${OUTPUT_DIR}" -name '*.ts' -not -path '*/node_modules/*' 2>/dev/null | wc -l)
  if [ "$ts_count" -gt 0 ]; then
    warn "  ${ts_count} .ts source files found in package (expected 0)"
  else
    success "  No .ts source files leaked into package"
  fi

  echo ""
  if [ "$errors" -eq 0 ]; then
    success "Standalone package validation PASSED - all checks OK"
  else
    error "Standalone package validation FAILED - ${errors} error(s)"
    exit 1
  fi
}

# --- Main ---------------------------------------------------------
main() {
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  devnull Standalone Package Builder"
  echo "  Project: ${PROJECT_DIR}"
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""

  step_build
  echo ""
  step_deps
  echo ""
  step_create_output
  echo ""
  step_copy
  echo ""
  step_readme
  echo ""
  step_tarball
  echo ""
  step_validate

  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Package Summary"
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""
  echo "  Directory: ${OUTPUT_DIR}"
  if [ "$CREATE_TARBALL" = true ]; then
    echo "  Tarball:   ${PROJECT_DIR}/devnull-standalone.tar.gz"
  fi
  echo ""
  echo "  Quick start:"
  echo "    cd ${OUTPUT_DIR}"
  echo "    cp .env.example .env"
  echo "    # Edit .env and add your DEEPSEEK_API_KEY"
  echo "    ./devnull-server.sh"
  echo ""
}

# --- Execute -------------------------------------------------------
main "$@"
