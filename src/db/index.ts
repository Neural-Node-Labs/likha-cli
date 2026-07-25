/**
 * Database abstraction layer for xcoder.
 *
 * Provides a configuration switch (DATABASE_TYPE=sqlite|postgres) with SQLite as default,
 * a connection factory that returns the appropriate client, and shared interfaces.
 *
 * Usage:
 *   import { createConnection, loadDatabaseConfig } from "../db/index.js";
 *   const db = createConnection();
 *   await db.query("SELECT 1");
 *   await db.close();
 */

export type { DatabaseType, DatabaseClient, QueryResult } from "./types.js";
export type { DatabaseConfig } from "./config.js";
export { loadDatabaseConfig } from "./config.js";
export { createConnection, createConnectionAsync } from "./connection.js";
export { initializeDatabase } from "./initialize.js";
export { runMigrations, listMigrations } from "./migrations.js";
export { SqliteClient } from "./sqliteClient.js";
export { PostgresClient } from "./postgresClient.js";

