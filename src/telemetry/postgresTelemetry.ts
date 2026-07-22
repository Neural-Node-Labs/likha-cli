import type { DatabaseClient } from "../db/types.js";
import { createConnection } from "../db/connection.js";
import { TelemetryInterface, ReActStep } from "../core/types.js";

/**
 * Database-backed telemetry implementation.
 * Stores ReAct steps, LLM calls, and errors in database tables.
 * Falls back gracefully if the database is unreachable (logs to console).
 *
 * Accepts a DatabaseClient (SQLite or PostgreSQL) instead of creating its own connection.
 *
 * Schema is auto-created on first connection via init().
 */
export class PostgresTelemetry implements TelemetryInterface {
  private db: DatabaseClient;
  private initialized = false;

  constructor(db?: DatabaseClient) {
    this.db = db ?? createConnection();
  }

  /**
   * Initialize the database schema. Creates tables if they don't exist.
   * Safe to call multiple times — uses IF NOT EXISTS.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS telemetry_logs (
          id SERIAL PRIMARY KEY,
          task_id TEXT,
          iteration INTEGER,
          phase TEXT,
          thought TEXT,
          action_tool TEXT,
          action_input TEXT,
          observation TEXT,
          score INTEGER,
          timestamp TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS telemetry_llm_calls (
          id SERIAL PRIMARY KEY,
          task_id TEXT,
          request TEXT,
          response TEXT,
          timestamp TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS telemetry_errors (
          id SERIAL PRIMARY KEY,
          task_id TEXT,
          context TEXT,
          error_message TEXT,
          error_stack TEXT,
          timestamp TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_telemetry_logs_task_id ON telemetry_logs(task_id);
        CREATE INDEX IF NOT EXISTS idx_telemetry_logs_timestamp ON telemetry_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_telemetry_llm_calls_task_id ON telemetry_llm_calls(task_id);
        CREATE INDEX IF NOT EXISTS idx_telemetry_errors_task_id ON telemetry_errors(task_id);
      `);
      this.initialized = true;
    } catch (err) {
      console.warn("[PostgresTelemetry] Failed to initialize database schema, using fallback:", err instanceof Error ? err.message : String(err));
    }
  }

  private async query(text: string, params?: unknown[]): Promise<void> {
    try {
      if (!this.initialized) await this.init();
      await this.db.query(text, params);
    } catch (err) {
      // Fallback: log to console
      console.warn("[PostgresTelemetry] Query failed, falling back:", err instanceof Error ? err.message : String(err));
    }
  }

  async logThought(step: ReActStep): Promise<void> {
    await this.query(
      `INSERT INTO telemetry_logs (task_id, iteration, phase, thought, action_tool, action_input, observation, score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        (step as any).taskId || null,
        step.iteration,
        step.phase,
        step.thought,
        step.action?.tool || null,
        step.action?.input ? JSON.stringify(step.action.input) : null,
        step.observation ? JSON.stringify(step.observation) : null,
        step.score ?? null,
      ]
    );
  }

  async logLlmCall(request: unknown, response: unknown): Promise<void> {
    await this.query(
      `INSERT INTO telemetry_llm_calls (request, response) VALUES (?, ?)`,
      [JSON.stringify(request), JSON.stringify(response)]
    );
  }

  async logError(err: unknown, context?: string): Promise<void> {
    const serialized = err instanceof Error
      ? { message: err.message, stack: err.stack }
      : { err };
    await this.query(
      `INSERT INTO telemetry_errors (context, error_message, error_stack) VALUES (?, ?, ?)`,
      [context || null, serialized.message || null, serialized.stack || null]
    );
  }

  /**
   * Get telemetry logs for a specific task.
   */
  async getLogsForTask(taskId: string, limit = 100): Promise<ReActStep[]> {
    try {
      if (!this.initialized) await this.init();
      const result = await this.db.query<any>(
        `SELECT * FROM telemetry_logs WHERE task_id = ? ORDER BY timestamp DESC LIMIT ?`,
        [taskId, limit]
      );
      return result.rows.map((row: any) => ({
        iteration: row.iteration,
        phase: row.phase,
        thought: row.thought,
        action: row.action_tool ? { tool: row.action_tool, input: row.action_input } : undefined,
        observation: row.observation,
        score: row.score,
      }));
    } catch (err) {
      console.warn("[PostgresTelemetry] Failed to get logs for task:", err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Get all telemetry logs with optional filters.
   */
  async getLogs(opts?: { taskId?: string; limit?: number; offset?: number; logType?: string }): Promise<any[]> {
    try {
      if (!this.initialized) await this.init();
      let query = "SELECT * FROM telemetry_logs WHERE 1=1";
      const params: unknown[] = [];

      if (opts?.taskId) {
        query += " AND task_id = ?";
        params.push(opts.taskId);
      }

      query += " ORDER BY timestamp DESC";

      if (opts?.limit) {
        query += " LIMIT ?";
        params.push(opts.limit);
      } else {
        query += " LIMIT 100";
      }

      if (opts?.offset) {
        query += " OFFSET ?";
        params.push(opts.offset);
      }

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (err) {
      console.warn("[PostgresTelemetry] Failed to get logs:", err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    try {
      await this.db.close();
    } catch {
      // ignore close errors
    }
  }
}

