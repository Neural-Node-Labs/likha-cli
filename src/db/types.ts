/**
 * Supported database backends.
 * - `sqlite`: file-based, zero-config, default
 * - `postgres`: full PostgreSQL via pg.Pool
 */
export type DatabaseType = "sqlite" | "postgres";

/**
 * Result of a database query.
 */
export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

/**
 * Common interface for all database clients.
 * Both SQLite and PostgreSQL implementations must conform to this.
 */
export interface DatabaseClient {
  /** Initialize the database (create tables, etc.). Safe to call multiple times. */
  init(): Promise<void>;

  /** Execute a query with optional parameters. Returns rows and count. */
  query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;

  /** Close the database connection / pool. */
  close(): Promise<void>;

  /** Whether the database has been initialized. */
  readonly initialized: boolean;
}

