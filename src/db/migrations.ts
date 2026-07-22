/**
 * Centralized migration system for xcoder's database layer.
 *
 * Supports both SQLite and PostgreSQL backends. Each backend has its own
 * set of migration SQL files in `migrations/<backend>/`. Migrations are
 * tracked in a `_migrations` table so they run exactly once.
 *
 * Usage:
 *   import { runMigrations } from "../db/migrations.js";
 *   import { createConnection } from "../db/connection.js";
 *   const db = createConnection();
 *   await runMigrations(db); // auto-detects backend type
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseClient } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = path.resolve(__dirname, "..", "..", "migrations");

/**
 * Detect the backend type from the client instance.
 * SQLite clients have a `dbPath` property; Postgres clients have a `pool`.
 */
function detectBackend(client: DatabaseClient): "sqlite" | "postgres" {
  // Duck-typing: SqliteClient has a `dbPath` string property
  if ("dbPath" in client && typeof (client as any).dbPath === "string") {
    return "sqlite";
  }
  return "postgres";
}

/**
 * Get the list of migration files for a given backend, sorted by filename.
 * Migration files should be named like `001_description.sql`.
 */
function getMigrationFiles(backend: "sqlite" | "postgres"): string[] {
  const migrationsDir = path.join(MIGRATIONS_ROOT, backend);
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // alphabetical sort works for 001_*, 002_* naming
  return files.map((f) => path.join(migrationsDir, f));
}

/**
 * Run all pending migrations for the given database client.
 * Creates the `_migrations` tracking table if it doesn't exist.
 * Each migration runs in a transaction (SQLite) or as a single statement (Postgres).
 *
 * Safe to call multiple times — already-applied migrations are skipped.
 */
export async function runMigrations(client: DatabaseClient): Promise<void> {
  const backend = detectBackend(client);
  const migrationFiles = getMigrationFiles(backend);

  if (migrationFiles.length === 0) {
    console.log(`[Migrations] No migration files found for ${backend} backend.`);
    return;
  }

  // Ensure the tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Get already-applied migrations
  const applied = await client.query<{ name: string }>(
    "SELECT name FROM _migrations ORDER BY name"
  );
  const appliedSet = new Set(applied.rows.map((r) => r.name));

  // Run pending migrations in order
  for (const filePath of migrationFiles) {
    const fileName = path.basename(filePath);

    if (appliedSet.has(fileName)) {
      console.log(`[Migrations] Skipping ${fileName} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(filePath, "utf-8").trim();
    if (!sql) {
      console.log(`[Migrations] Skipping ${fileName} (empty file)`);
      continue;
    }

    console.log(`[Migrations] Applying ${fileName}...`);

    try {
      // Run the migration SQL
      await client.query(sql);

      // Record the migration as applied
      await client.query(
        "INSERT INTO _migrations (name) VALUES (?)",
        [fileName]
      );

      console.log(`[Migrations] Applied ${fileName}`);
    } catch (err) {
      console.error(
        `[Migrations] Failed to apply ${fileName}:`,
        err instanceof Error ? err.message : String(err)
      );
      throw err;
    }
  }

  console.log(`[Migrations] All ${backend} migrations applied.`);
}

/**
 * List all migrations (applied and pending) for the given client.
 * Returns an array of { name, appliedAt } where appliedAt is null for pending.
 */
export async function listMigrations(
  client: DatabaseClient
): Promise<{ name: string; appliedAt: string | null }[]> {
  const backend = detectBackend(client);
  const migrationFiles = getMigrationFiles(backend);
  const fileNames = new Set(migrationFiles.map((f) => path.basename(f)));

  // Get applied migrations
  let applied: { name: string; applied_at: string }[] = [];
  try {
    const result = await client.query<{ name: string; applied_at: string }>(
      "SELECT name, applied_at FROM _migrations ORDER BY name"
    );
    applied = result.rows;
  } catch {
    // _migrations table may not exist yet
  }

  const appliedMap = new Map(applied.map((r) => [r.name, r.applied_at]));

  // Merge with all known migration files
  const allNames = [...fileNames].sort();
  return allNames.map((name) => ({
    name,
    appliedAt: appliedMap.get(name) ?? null,
  }));
}

