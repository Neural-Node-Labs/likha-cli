import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseClient, QueryResult } from "./types.js";

/**
 * Translates PostgreSQL-style SQL to SQLite-compatible SQL.
 *
 * Transformations applied:
 * 1. `$1, $2, ...` positional params → `?` (SQLite style)
 * 2. `ILIKE` → `LIKE` (SQLite doesn't support ILIKE; use COLLATE NOCASE)
 * 3. `TIMESTAMPTZ` → `TEXT` (SQLite has no native datetime type)
 * 4. `NOW()` → `(datetime('now'))` (SQLite datetime function)
 * 5. `EXCLUDED.` → `excluded.` (SQLite uses lowercase for ON CONFLICT)
 * 6. `::type` casts → stripped (SQLite doesn't support type casts)
 * 7. `SERIAL PRIMARY KEY` → `INTEGER PRIMARY KEY AUTOINCREMENT`
 * 8. `JSONB` → `TEXT`
 * 9. `BOOLEAN` → `INTEGER` (SQLite uses 0/1 for booleans)
 * 10. `TRUE`/`FALSE` → `1`/`0` in DEFAULT contexts
 * 11. `RETURNING *` → stripped (better-sqlite3 .run() doesn't return rows)
 */
function translateSql(sql: string): string {
  let result = sql;

  // 1. $N positional params → ? (must be done before other transforms)
  result = result.replace(/\$(\d+)/g, "?");

  // 2. ILIKE → LIKE with COLLATE NOCASE for case-insensitive matching
  result = result.replace(/\bILIKE\b/gi, "LIKE");

  // 3. TIMESTAMPTZ → TEXT
  result = result.replace(/\bTIMESTAMPTZ\b/gi, "TEXT");

  // 4. NOW() → datetime('now')
  result = result.replace(/\bNOW\s*\(\s*\)/gi, "(datetime('now'))");

  // 5. EXCLUDED. → excluded. (SQLite is case-sensitive for this)
  result = result.replace(/\bEXCLUDED\./g, "excluded.");

  // 6. ::type casts → strip them
  result = result.replace(/::\w+/g, "");

  // 7. SERIAL PRIMARY KEY → INTEGER PRIMARY KEY AUTOINCREMENT
  result = result.replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, "INTEGER PRIMARY KEY AUTOINCREMENT");

  // 8. JSONB → TEXT
  result = result.replace(/\bJSONB\b/gi, "TEXT");

  // 9. BOOLEAN DEFAULT TRUE/FALSE → INTEGER DEFAULT 1/0
  result = result.replace(/\bBOOLEAN\s+DEFAULT\s+TRUE\b/gi, "INTEGER DEFAULT 1");
  result = result.replace(/\bBOOLEAN\s+DEFAULT\s+FALSE\b/gi, "INTEGER DEFAULT 0");
  result = result.replace(/\bBOOLEAN\b/gi, "INTEGER");

  // 10. TRUE/FALSE as standalone values → 1/0
  result = result.replace(/\bTRUE\b/gi, "1");
  result = result.replace(/\bFALSE\b/gi, "0");

  // 11. Strip RETURNING clauses (better-sqlite3 .run() doesn't return rows)
  result = result.replace(/\s+RETURNING\s+\*?\s*/gi, "");

  return result;
}

/**
 * SQLite-backed database client.
 * Uses better-sqlite3 (synchronous, fast, zero-config).
 *
 * Follows the same graceful fallback pattern as the existing Postgres stores:
 * - init() creates tables if they don't exist
 * - All public methods catch errors, log warnings, and return safe fallbacks
 * - close() releases the database handle
 *
 * Automatically translates PostgreSQL SQL dialect to SQLite-compatible SQL.
 */
export class SqliteClient implements DatabaseClient {
  private db: Database.Database | null = null;
  private _initialized = false;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    try {
      // Ensure the parent directory exists before opening the database
      const dbDir = path.dirname(this.dbPath);
      fs.mkdirSync(dbDir, { recursive: true });

      this.db = new Database(this.dbPath);
      // Enable WAL mode for better concurrent read performance
      this.db.pragma("journal_mode = WAL");
      // Enable foreign keys
      this.db.pragma("foreign_keys = ON");
      this._initialized = true;
    } catch (err) {
      console.warn("[SqliteClient] Failed to initialize:", err instanceof Error ? err.message : String(err));
    }
  }

  async query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    try {
      if (!this._initialized) await this.init();
      if (!this.db) {
        console.warn("[SqliteClient] Not initialized — returning empty result");
        return { rows: [], rowCount: 0 };
      }

      // Translate PostgreSQL SQL dialect to SQLite
      const translated = translateSql(text);
      const trimmed = translated.trim().toUpperCase();
      const isSelect = trimmed.startsWith("SELECT") || trimmed.startsWith("WITH");
      const isInsert = trimmed.startsWith("INSERT");
      const isUpdate = trimmed.startsWith("UPDATE");
      const isDelete = trimmed.startsWith("DELETE");

      if (isSelect) {
        // SELECT / WITH — returns rows
        const stmt = this.db.prepare(translated);
        const rows = params ? stmt.all(...params) : stmt.all();
        return { rows: rows as T[], rowCount: rows.length };
      } else if (isInsert || isUpdate || isDelete) {
        // INSERT / UPDATE / DELETE — returns info
        const stmt = this.db.prepare(translated);
        const info = params ? stmt.run(...params) : stmt.run();
        return { rows: [{ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }] as unknown as T[], rowCount: info.changes };
      } else {
        // Other statements (CREATE, ALTER, PRAGMA, etc.)
        const stmt = this.db.prepare(translated);
        if (params) {
          stmt.run(...params);
        } else {
          stmt.run();
        }
        return { rows: [], rowCount: 0 };
      }
    } catch (err) {
      console.warn("[SqliteClient] Query failed:", err instanceof Error ? err.message : String(err));
      return { rows: [], rowCount: 0 };
    }
  }

  async close(): Promise<void> {
    try {
      if (this.db) {
        this.db.close();
        this.db = null;
        this._initialized = false;
      }
    } catch {
      // ignore close errors
    }
  }
}

