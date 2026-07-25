#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# init-db.sh — Initialize the devnull PostgreSQL database
#
# Creates the PostgreSQL database (if not exists) and all required tables,
# indexes, and extensions. Designed to be idempotent — safe to re-run.
#
# Usage:
#   ./scripts/init-db.sh                          # Use defaults
#   ./scripts/init-db.sh --db-url postgresql://... # Custom connection string
#   ./scripts/init-db.sh --help                    # Show help
#
# Environment:
#   DATABASE_URL    — PostgreSQL connection string (default: see below)
#   PGHOST          — PostgreSQL host (default: localhost)
#   PGPORT          — PostgreSQL port (default: 5432)
#   PGUSER          — PostgreSQL user (default: devnull)
#   PGPASSWORD      — PostgreSQL password (default: devnull_pass)
#   PGDATABASE      — PostgreSQL database name (default: devnull)
#
# Idempotency:
#   - CREATE DATABASE IF NOT EXISTS (via shell check)
#   - CREATE TABLE IF NOT EXISTS (via SQL)
#   - CREATE INDEX IF NOT EXISTS (via SQL)
#   - Safe to re-run at any time
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

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

Initialize the devnull PostgreSQL database.

Options:
  --db-url URL      PostgreSQL connection string (overrides env vars)
  --help            Show this help message

Environment variables:
  DATABASE_URL      PostgreSQL connection string (takes precedence)
  PGHOST            PostgreSQL host (default: localhost)
  PGPORT            PostgreSQL port (default: 5432)
  PGUSER            PostgreSQL user (default: devnull)
  PGPASSWORD        PostgreSQL password (default: devnull_pass)
  PGDATABASE        PostgreSQL database name (default: devnull)

Idempotent: safe to re-run at any time.
EOF
  exit 0
}

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-url)
      DATABASE_URL="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      ;;
    *)
      error "Unknown option: $1"
      echo "Usage: $(basename "$0") [--db-url URL] [--help]"
      exit 1
      ;;
  esac
done

# ─── Resolve connection parameters ───────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
  info "Using DATABASE_URL for connection"
  # Extract components from DATABASE_URL for psql
  # Format: postgresql://user:password@host:port/database
  DB_URL="$DATABASE_URL"
else
  PGHOST="${PGHOST:-localhost}"
  PGPORT="${PGPORT:-5432}"
  PGUSER="${PGUSER:-devnull}"
  PGPASSWORD="${PGPASSWORD:-devnull_pass}"
  PGDATABASE="${PGDATABASE:-devnull}"
  DB_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"
fi

# ─── Check prerequisites ─────────────────────────────────────────────────────
check_prereqs() {
  if ! command -v psql &>/dev/null; then
    error "psql not found. Install PostgreSQL client tools:"
    error "  Debian/Ubuntu: apt-get install postgresql-client"
    error "  Alpine:        apk add postgresql-client"
    error "  macOS:         brew install libpq"
    exit 1
  fi
  success "PostgreSQL client found: $(psql --version 2>&1 | head -1)"
}

# ─── Create database if not exists ───────────────────────────────────────────
create_database() {
  info "Checking if database exists..."

  # Connect to the 'postgres' default database to create our database
  local admin_url
  admin_url=$(echo "$DB_URL" | sed 's|/[^/]*$|/postgres|')

  local db_name
  db_name=$(echo "$DB_URL" | sed 's|.*/||')

  local exists
  exists=$(psql "$admin_url" -t -c "SELECT 1 FROM pg_database WHERE datname='${db_name}'" 2>/dev/null || echo "")

  if [ -n "$exists" ]; then
    success "Database '${db_name}' already exists"
  else
    info "Creating database '${db_name}'..."
    psql "$admin_url" -c "CREATE DATABASE ${db_name}" 2>&1
    success "Database '${db_name}' created"
  fi
}

# ─── Create tables ───────────────────────────────────────────────────────────
create_tables() {
  info "Creating tables (if not exists)..."

  psql "$DB_URL" <<'SQL'
-- ============================================================================
-- Task History
-- Stores completed top-level tasks for the task_history_tool
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_history (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  summary TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  iterations INTEGER DEFAULT 0,
  total_tokens INTEGER
);

CREATE INDEX IF NOT EXISTS idx_task_history_timestamp
  ON task_history(timestamp DESC);

-- ============================================================================
-- Phase Reports
-- Stores phase report content, tokens, iterations per phase
-- ============================================================================
CREATE TABLE IF NOT EXISTS phase_reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  phase_number INTEGER NOT NULL,
  phase_title TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens INTEGER DEFAULT 0,
  iterations INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phase_reports_task_id
  ON phase_reports(task_id);

-- ============================================================================
-- WBS Entries
-- Stores Work Breakdown Structure entries with status tracking per phase
-- ============================================================================
CREATE TABLE IF NOT EXISTS wbs_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_description TEXT NOT NULL,
  phase_number INTEGER NOT NULL,
  phase_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wbs_entries_task_id
  ON wbs_entries(task_id);

-- ============================================================================
-- Plans
-- Stores saved plans with task descriptions and plan content
-- ============================================================================
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  task_description TEXT NOT NULL,
  plan_content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_created_at
  ON plans(created_at DESC);

-- ============================================================================
-- Plan Tasks
-- Stores individual tasks within a plan with status tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS plan_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan_id
  ON plan_tasks(plan_id);

-- ============================================================================
-- Users
-- Stores registered users for API authentication
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users(username);

-- ============================================================================
-- LLM Keys
-- Stores encrypted LLM API keys per user
-- ============================================================================
CREATE TABLE IF NOT EXISTS llm_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  key_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_llm_keys_user_id
  ON llm_keys(user_id);

-- ============================================================================
-- Projects
-- Stores user projects with workspace paths
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  workspace_path TEXT,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id
  ON projects(user_id);

-- ============================================================================
-- Telemetry Logs
-- Stores structured telemetry data (thinking, llm, sys logs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS telemetry_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  log_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_logs_task_id
  ON telemetry_logs(task_id);

CREATE INDEX IF NOT EXISTS idx_telemetry_logs_log_type
  ON telemetry_logs(log_type);

CREATE INDEX IF NOT EXISTS idx_telemetry_logs_created_at
  ON telemetry_logs(created_at DESC);

SQL

  success "All tables created/verified"
}

# ─── Verify tables ───────────────────────────────────────────────────────────
verify_tables() {
  info "Verifying tables..."

  local expected_tables=(
    "task_history"
    "phase_reports"
    "wbs_entries"
    "plans"
    "plan_tasks"
    "users"
    "llm_keys"
    "projects"
    "telemetry_logs"
  )

  local errors=0
  for table in "${expected_tables[@]}"; do
    local exists
    exists=$(psql "$DB_URL" -t -c "SELECT 1 FROM information_schema.tables WHERE table_name='${table}'" 2>/dev/null || echo "")
    if [ -n "$exists" ]; then
      success "Table exists: ${table}"
    else
      error "Table missing: ${table}"
      errors=$((errors + 1))
    fi
  done

  echo ""
  if [ "$errors" -eq 0 ]; then
    success "Database initialization complete — all ${#expected_tables[@]} tables verified"
  else
    error "Database initialization completed with ${errors} error(s)"
    exit 1
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  devnull Database Initialization"
  echo "  URL:    ${DB_URL}"
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""

  check_prereqs
  echo ""
  create_database
  echo ""
  create_tables
  echo ""
  verify_tables
}

main "$@"
