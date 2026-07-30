import { fork, ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accessSync } from "node:fs";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface SubprocessOptions {
  /** Maximum wall-clock time (ms) before the process is killed. Default: 30_000 (30s). */
  timeoutMs?: number;
  /** Interval (ms) between expected heartbeat pings from the worker. Default: 2_000 (2s). */
  heartbeatIntervalMs?: number;
  /** How many missed heartbeat intervals before the process is considered hung. Default: 2. */
  heartbeatMissedLimit?: number;
  /** Arguments passed to the worker via IPC message. */
  workerData?: unknown;
}

export interface SubprocessResult {
  /** The worker's final output (stdout or IPC result). */
  result: unknown;
  /** Process exit code. */
  exitCode: number | null;
  /** True if the process was killed due to timeout. */
  timedOut: boolean;
  /** True if the process exited with a non-zero code or was killed by a signal. */
  crashed: boolean;
  /** The signal that killed the process, if any. */
  signal?: string;
  /** Error message if the process crashed or timed out. */
  error?: string;
  /** stderr output captured from the process. */
  stderr: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_MISSED_LIMIT = 2;

// ─── SubprocessManager ────────────────────────────────────────────────────────────

/**
 * Manages a child process (forked via `child_process.fork()`) with:
 * - Configurable timeout (SIGTERM → SIGKILL escalation)
 * - Exit-code monitoring (non-zero = crash)
 * - Heartbeat mechanism (periodic IPC ping from worker)
 * - Cleanup on timeout/crash
 *
 * Returns a `SubprocessResult` object with the outcome.
 *
 * @example
 * ```ts
 * const manager = new SubprocessManager();
 * const result = await manager.spawn(workerPath, {
 *   timeoutMs: 15_000,
 *   workerData: { task: "do something" },
 * });
 * if (result.crashed) {
 *   console.error("Worker crashed:", result.error);
 * }
 * ```
 */
export class SubprocessManager {
  /**
   * Spawn a worker script in a child process and wait for it to complete.
   *
   * @param workerModulePath - Absolute path to the worker module (`.js` or `.ts`).
   *   The module must export a default function or listen for IPC messages.
   * @param options - Configuration for timeout, heartbeat, and worker data.
   * @returns A `SubprocessResult` describing the outcome.
   */
  async spawn(
    workerModulePath: string,
    options: SubprocessOptions = {}
  ): Promise<SubprocessResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    const heartbeatMissedLimit = options.heartbeatMissedLimit ?? DEFAULT_HEARTBEAT_MISSED_LIMIT;

    // ── Fork the child process ──────────────────────────────────────────────────
    const child: ChildProcess = fork(workerModulePath, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env, XCODER_SUBAGENT: "1" },
    });

    // ── State ───────────────────────────────────────────────────────────────────
    let settled = false;
    let timedOut = false;
    let crashed = false;
    let exitCode: number | null = null;
    let signal: string | undefined;
    let result: unknown = undefined;
    let error: string | undefined;
    let stderr = "";

    // Heartbeat tracking
    let lastHeartbeat = Date.now();
    let heartbeatCheckTimer: ReturnType<typeof setInterval> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    // ── Promise that resolves when the process settles ──────────────────────────
    const settlePromise = new Promise<SubprocessResult>((resolve) => {
      // ── stderr capture ──────────────────────────────────────────────────────
      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf-8");
        });
      }

      // ── IPC message handling ────────────────────────────────────────────────
      child.on("message", (msg: unknown) => {
        const message = msg as Record<string, unknown>;

        if (message?.type === "heartbeat") {
          lastHeartbeat = Date.now();
          return; // don't settle on heartbeat
        }

        if (message?.type === "result") {
          result = message.data;
          return; // wait for exit to settle
        }

        if (message?.type === "error") {
          error = String(message.data ?? "Unknown worker error");
          return; // wait for exit to settle
        }
      });

      // ── Process exit ────────────────────────────────────────────────────────
      child.on("exit", (code, sig) => {
        exitCode = code;
        signal = sig ?? undefined;

        if (!settled) {
          settled = true;
          cleanup();

          if (code !== 0 || sig) {
            crashed = true;
            error = error || `Process exited with code ${code}${sig ? ` (signal: ${sig})` : ""}`;
          }

          resolve({
            result,
            exitCode,
            timedOut,
            crashed,
            signal,
            error,
            stderr,
          });
        }
      });

      // ── Process error (e.g., cannot fork) ───────────────────────────────────
      child.on("error", (err) => {
        if (!settled) {
          settled = true;
          cleanup();
          crashed = true;
          error = `Failed to spawn worker: ${err.message}`;
          resolve({
            result,
            exitCode,
            timedOut,
            crashed,
            signal,
            error,
            stderr,
          });
        }
      });
    });

    // ── Cleanup function ───────────────────────────────────────────────────────
    const cleanup = () => {
      if (killTimer) clearTimeout(killTimer);
      if (heartbeatCheckTimer) clearInterval(heartbeatCheckTimer);
      killTimer = undefined;
      heartbeatCheckTimer = undefined;
    };

    // ── Timeout: SIGTERM → SIGKILL escalation ──────────────────────────────────
    killTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      error = `Worker timed out after ${timeoutMs}ms`;

      // Send SIGTERM first
      try {
        child.kill("SIGTERM");
      } catch {
        // process may already be dead
      }

      // If still alive after 3s, escalate to SIGKILL
      setTimeout(() => {
        if (settled) return;
        try {
          child.kill("SIGKILL");
        } catch {
          // process may already be dead
        }
      }, 3_000);
    }, timeoutMs);

    // ── Heartbeat monitoring ───────────────────────────────────────────────────
    heartbeatCheckTimer = setInterval(() => {
      if (settled) return;
      const elapsed = Date.now() - lastHeartbeat;
      if (elapsed > heartbeatIntervalMs * heartbeatMissedLimit) {
        // Missed too many heartbeats — treat as hung
        if (!settled) {
          timedOut = true;
          error = `Worker hung: no heartbeat for ${elapsed}ms (missed limit: ${heartbeatMissedLimit} intervals of ${heartbeatIntervalMs}ms)`;

          try {
            child.kill("SIGTERM");
          } catch {
            // process may already be dead
          }

          // Escalate to SIGKILL after 3s
          setTimeout(() => {
            if (settled) return;
            try {
              child.kill("SIGKILL");
            } catch {
              // process may already be dead
            }
          }, 3_000);
        }
      }
    }, heartbeatIntervalMs);

    // ── Send worker data via IPC ───────────────────────────────────────────────
    if (options.workerData !== undefined) {
      child.send({ type: "start", data: options.workerData });
    }

    // ── Wait for settlement ────────────────────────────────────────────────────
    return settlePromise;
  }

  /**
   * Kill a managed child process. Safe to call even if the process already exited.
   */
  kill(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
    try {
      child.kill(signal);
    } catch {
      // process may already be dead
    }
  }
}

// ─── Convenience factory ──────────────────────────────────────────────────────────

let defaultManager: SubprocessManager | undefined;

/**
 * Get or create the default SubprocessManager singleton.
 */
export function getDefaultManager(): SubprocessManager {
  if (!defaultManager) {
    defaultManager = new SubprocessManager();
  }
  return defaultManager;
}

/**
 * Resolve the path to a worker module relative to this source file.
 * Handles both `.ts` (dev/ts-node) and `.js` (compiled) extensions.
 *
 * In dev mode (ts-node), the `.ts` file is used directly.
 * In production, the compiled `.js` file is used.
 */
export function resolveWorkerPath(relativePath: string): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const resolved = path.resolve(__dirname, relativePath);

  // Check if the .ts file exists (dev mode)
  const tsPath = resolved.replace(/\.js$/, ".ts");
  if (resolved.endsWith(".js")) {
    // Try .ts first (dev mode with ts-node), fall back to .js (production)
    try {
      require("fs").accessSync(tsPath);
      return tsPath;
    } catch {
      return resolved;
    }
  }

  return resolved;
}

// Import fs for resolveWorkerPath

