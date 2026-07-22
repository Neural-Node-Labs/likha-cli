import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { DatabaseType } from "./types.js";

/**
 * All configurable database connection parameters.
 *
 * Defaults:
 * - DATABASE_TYPE=sqlite
 * - SQLite path: ~/.xcoder/data/xcoder.db
 * - Postgres: localhost:5432, xcoder/xcoder_pass, database=xcoder
 */
export interface DatabaseConfig {
  /** Which backend to use: "sqlite" (default) or "postgres" */
  type: DatabaseType;

  // ─── SQLite-specific ──────────────────────────────────────────────────
  /** Path to the SQLite database file. Default: ~/.xcoder/data/xcoder.db */
  sqlitePath: string;

  // ─── PostgreSQL-specific ───────────────────────────────────────────────
  /** Full connection string (overrides individual params if set) */
  postgresUrl?: string;
  postgresHost: string;
  postgresPort: number;
  postgresDatabase: string;
  postgresUser: string;
  postgresPassword: string;
  postgresSsl: boolean;
  postgresMax: number;
  postgresIdleTimeoutMillis: number;
  postgresConnectionTimeoutMillis: number;
}

/**
 * Default SQLite database path: ~/.xcoder/data/xcoder.db
 * Creates the directory if it doesn't exist.
 */
function defaultSqlitePath(): string {
  const home = process.env.XCODER_HOME || os.homedir();
  const dbDir = path.join(home, ".xcoder", "data");
  // Ensure the directory exists (synchronous on first load is acceptable here)
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch {
    // Directory may already exist or be unwritable — caller handles errors
  }
  return path.join(dbDir, "xcoder.db");
}

/**
 * Load database configuration from environment variables.
 *
 * Environment variables:
 *   DATABASE_TYPE          = "sqlite" (default) | "postgres"
 *   DATABASE_URL           = PostgreSQL connection string (overrides individual params)
 *   DATABASE_SQLITE_PATH   = custom SQLite file path (default: ~/.xcoder/data/xcoder.db)
 *   DATABASE_HOST          = PostgreSQL host (default: localhost)
 *   DATABASE_PORT          = PostgreSQL port (default: 5432)
 *   DATABASE_NAME          = PostgreSQL database name (default: xcoder)
 *   DATABASE_USER          = PostgreSQL user (default: xcoder)
 *   DATABASE_PASSWORD      = PostgreSQL password (default: xcoder_pass)
 *   DATABASE_SSL           = "true" to enable SSL (default: false)
 *   DATABASE_POOL_MAX      = max pool size (default: 5)
 *   DATABASE_POOL_IDLE     = idle timeout ms (default: 30000)
 *   DATABASE_POOL_TIMEOUT  = connection timeout ms (default: 5000)
 */
export function loadDatabaseConfig(): DatabaseConfig {
  const rawType = (process.env.DATABASE_TYPE || "sqlite").toLowerCase().trim();
  const type: DatabaseType = rawType === "postgres" ? "postgres" : "sqlite";

  return {
    type,

    // SQLite
    sqlitePath: process.env.DATABASE_SQLITE_PATH || defaultSqlitePath(),

    // PostgreSQL
    postgresUrl: process.env.DATABASE_URL,
    postgresHost: process.env.DATABASE_HOST || "localhost",
    postgresPort: parseInt(process.env.DATABASE_PORT || "5432", 10),
    postgresDatabase: process.env.DATABASE_NAME || "xcoder",
    postgresUser: process.env.DATABASE_USER || "xcoder",
    postgresPassword: process.env.DATABASE_PASSWORD || "xcoder_pass",
    postgresSsl: process.env.DATABASE_SSL === "true",
    postgresMax: parseInt(process.env.DATABASE_POOL_MAX || "5", 10),
    postgresIdleTimeoutMillis: parseInt(process.env.DATABASE_POOL_IDLE || "30000", 10),
    postgresConnectionTimeoutMillis: parseInt(process.env.DATABASE_POOL_TIMEOUT || "5000", 10),
  };
}

