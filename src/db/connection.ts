import type { DatabaseClient } from "./types.js";
import type { DatabaseConfig } from "./config.js";
import { loadDatabaseConfig } from "./config.js";
import { SqliteClient } from "./sqliteClient.js";
import { PostgresClient } from "./postgresClient.js";

/**
 * Create a database client based on the provided configuration.
 * Defaults to SQLite if no config is provided.
 *
 * Usage:
 *   const db = createConnection();           // SQLite with defaults
 *   const db = createConnection(myConfig);   // explicit config
 *   const db = await createConnectionAsync(); // convenience: loads config + creates
 */
export function createConnection(config?: DatabaseConfig): DatabaseClient {
  const resolved = config ?? loadDatabaseConfig();

  switch (resolved.type) {
    case "postgres":
      return new PostgresClient(resolved);
    case "sqlite":
    default:
      return new SqliteClient(resolved.sqlitePath);
  }
}

/**
 * Convenience function: loads config from env vars and creates the connection.
 * Equivalent to `createConnection(loadDatabaseConfig())`.
 */
export async function createConnectionAsync(): Promise<DatabaseClient> {
  const config = loadDatabaseConfig();
  const client = createConnection(config);
  await client.init();
  return client;
}

