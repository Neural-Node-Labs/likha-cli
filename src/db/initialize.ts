/**
 * Centralized database initialization for the xcoder API server.
 *
 * Creates all required tables at server startup so that stores can assume
 * the database is already initialized. This replaces the per-store lazy
 * initialization pattern where each store created its own connection and
 * called init() on first use.
 *
 * Usage:
 *   import { initializeDatabase } from "../db/initialize.js";
 *   const db = await initializeDatabase();
 *   // db is ready — pass to stores
 */

import { createConnection } from "./connection.js";
import type { DatabaseClient } from "./types.js";

/**
 * Initialize the database: open the connection, create all tables, and
 * return the ready-to-use client.
 *
 * Safe to call multiple times — all CREATE TABLE statements use IF NOT EXISTS.
 */
export async function initializeDatabase(): Promise<DatabaseClient> {
  const db = createConnection();
  await db.init();

  // ─── Plans ────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      task_description TEXT NOT NULL,
      plan_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
  `);

  // ─── Plan Tasks ───────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS plan_tasks (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      task_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan_id ON plan_tasks(plan_id);
  `);

  // ─── Phase Reports ────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS phase_reports (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      phase_number INTEGER NOT NULL,
      phase_title TEXT NOT NULL,
      content TEXT NOT NULL,
      tokens INTEGER DEFAULT 0,
      iterations INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_phase_reports_task_id ON phase_reports(task_id);
  `);

  // ─── WBS Entries ──────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS wbs_entries (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_description TEXT NOT NULL,
      phase_number INTEGER NOT NULL,
      phase_title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_wbs_entries_task_id ON wbs_entries(task_id);
  `);

  // ─── Task History ─────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS task_history (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      summary TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      iterations INTEGER DEFAULT 0,
      total_tokens INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_task_history_timestamp ON task_history(timestamp DESC);
  `);

  // ─── Projects ─────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      active INTEGER DEFAULT 0,
      include_in_llm INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(active);
  `);

  console.log("[Database] All tables initialized.");
  return db;
}

