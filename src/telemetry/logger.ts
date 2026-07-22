import fs from "node:fs";
import path from "node:path";
import { TelemetryInterface, ReActStep } from "../core/types.js";

/**
 * Default telemetry implementation: flat log files under .log/.
 * This satisfies the TelemetryInterface stub so xcoder works with zero config.
 * Swap this out (Postgres/SQLite) by implementing TelemetryInterface and wiring
 * it in core/orchestrator instead of FileTelemetry.
 *
 * Log rotation: when a log file exceeds MAX_LOG_SIZE (default 2MB), it is renamed
 * to <name>_YYYY-MM-DD.log and a new file is started. This prevents unbounded
 * disk usage from long-running sessions.
 */
export class FileTelemetry implements TelemetryInterface {
  private logDir: string;
  private maxLogSize: number;

  constructor(workspaceRoot: string = process.cwd(), maxLogSize?: number) {
    this.logDir = path.join(workspaceRoot, ".log");
    this.maxLogSize = maxLogSize ?? 2 * 1024 * 1024; // 2 MB default
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  /**
   * Check if a file exceeds the max size and rotate it if so.
   * Renames <file> to <name>_YYYY-MM-DD.log and creates a fresh <file>.
   */
  private rotateIfNeeded(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.size >= this.maxLogSize) {
          const ext = path.extname(filePath);
          const base = filePath.slice(0, -ext.length);
          const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
          const rotatedPath = `${base}_${dateStr}${ext}`;
          // Avoid overwriting an already-rotated file from the same day
          let finalPath = rotatedPath;
          let counter = 1;
          while (fs.existsSync(finalPath)) {
            finalPath = `${base}_${dateStr}_${counter}${ext}`;
            counter++;
          }
          fs.renameSync(filePath, finalPath);
        }
      }
    } catch {
      // If rotation fails (permissions, etc.), just continue appending
    }
  }

  private append(file: string, line: unknown) {
    const p = path.join(this.logDir, file);
    this.rotateIfNeeded(p);
    const entry = `${new Date().toISOString()} ${JSON.stringify(line)}\n`;
    fs.appendFileSync(p, entry, "utf-8");
  }

  async logThought(step: ReActStep): Promise<void> {
    this.append("thinking.log", step);
  }

  async logLlmCall(request: unknown, response: unknown): Promise<void> {
    this.append("llm.log", { request, response });
  }

  async logError(err: unknown, context?: string): Promise<void> {
    const serialized =
      err instanceof Error ? { message: err.message, stack: err.stack } : { err };
    this.append("sys.log", { context, ...serialized });
  }
}

/** No-op telemetry, useful for tests or when logging is explicitly disabled. */
export class NullTelemetry implements TelemetryInterface {
  async logThought(): Promise<void> {}
  async logLlmCall(): Promise<void> {}
  async logError(): Promise<void> {}
}


