// ronin:version 5 | ronin:task task-b88b43 | ronin:updated 2026-08-13T06:17:34.564Z | ronin:subtask test-st-eaae62
/**
 * processCrashHandler.ts — Top-level process crash handler for the main agent.
 *
 * Provides a single `installProcessCrashHandler()` call that registers handlers for
 * `uncaughtException` and `unhandledRejection` at the process level. When a crash
 * is detected, the handler:
 *
 * 1. Logs the error with full stack trace to stderr
 * 2. Generates a crash report file at `reports/crash-<timestamp>.md`
 * 3. Attempts graceful shutdown (flush pending writes, close open handles)
 * 4. Exits with code 1 — NO restart/retry logic to avoid infinite restart loops
 *
 * ## Restart-Loop Guard
 * - A module-level `installed` flag prevents double-registration of handlers
 * - A 1-second debounce prevents rapid re-entry from cascading errors
 * - The handler calls `process.exit(1)` unconditionally after cleanup
 *
 * ## Usage
 * ```ts
 * import { installProcessCrashHandler } from "./core/processCrashHandler.js";
 * installProcessCrashHandler();
 * ```
 *
 * Call this at the very top of the main entry point, before any other initialization,
 * to ensure it catches crashes from all code paths.
 */

import fs from "node:fs";
import path from "node:path";

// ─── Module-level state ───────────────────────────────────────────────────────────

/** Prevents double-registration of crash handlers. */
let installed = false;

/** Timestamp of the last crash event — used for debounce. */
let lastCrashTime = 0;

/** References to the registered handlers so reset can remove them. */
let uncaughtHandler: ((err: Error) => void) | undefined;
let unhandledHandler: ((reason: unknown) => void) | undefined;

/** Debounce interval in milliseconds — prevents rapid re-entry from cascading errors. */
const DEBOUNCE_MS = 1_000;

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface CrashReport {
  /** ISO 8601 timestamp of the crash. */
  timestamp: string;
  /** The error message. */
  message: string;
  /** The full stack trace, if available. */
  stack?: string;
  /** The type of crash: "uncaughtException" or "unhandledRejection". */
  crashType: "uncaughtException" | "unhandledRejection";
  /** Node.js version. */
  nodeVersion: string;
  /** Process arguments. */
  argv: string[];
  /** Current working directory. */
  cwd: string;
  /** Platform. */
  platform: string;
}

// ─── Crash report generation ──────────────────────────────────────────────────────

/**
 * Generate a crash report file at `reports/crash-<timestamp>.md` in the given
 * workspace root directory.
 *
 * @param workspaceRoot - The project root directory (defaults to process.cwd()).
 * @param report - The crash report data.
 * @returns The path to the generated crash report file.
 */
export function generateCrashReport(
  workspaceRoot: string,
  report: CrashReport
): string {
  const reportsDir = path.join(workspaceRoot, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date(report.timestamp).getTime();
  const reportPath = path.join(reportsDir, `crash-${timestamp}.md`);

  const markdown = [
    `# Crash Report`,
    ``,
    `**Timestamp:** ${report.timestamp}`,
    `**Type:** ${report.crashType}`,
    `**Node.js:** ${report.nodeVersion}`,
    `**Platform:** ${report.platform}`,
    `**CWD:** ${report.cwd}`,
    `**Arguments:** \`${report.argv.join(" ")}\``,
    ``,
    `## Error`,
    ``,
    `\`\`\``,
    report.message,
    `\`\`\``,
    ``,
  ];

  if (report.stack) {
    markdown.push(
      `## Stack Trace`,
      ``,
      `\`\`\``,
      report.stack,
      `\`\`\``,
      ``,
    );
  }

  markdown.push(
    `## What Happened`,
    ``,
    `The main process encountered an unhandled error and was terminated gracefully.`,
    `No automatic restart was attempted — this is a single-exit crash handler by design.`,
    `Inspect the error above and the application logs under \`.log/\` for more context.`,
    ``,
  );

  fs.writeFileSync(reportPath, markdown.join("\n"), "utf-8");
  return reportPath;
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────────

/**
 * Attempt graceful shutdown before exiting.
 *
 * This is intentionally synchronous — we're in a crash handler and can't await
 * async operations. We do what we can synchronously:
 * - Flush any pending file writes (sync writes are already flushed by Node)
 * - Log the crash to stderr
 * - Generate the crash report
 *
 * @param workspaceRoot - The project root directory.
 * @param report - The crash report data.
 */
function gracefulShutdown(workspaceRoot: string, report: CrashReport): void {
  // Log to stderr
  console.error("");
  console.error("=".repeat(60));
  console.error(`[CRASH] ${report.crashType} — ${report.message}`);
  if (report.stack) {
    console.error(report.stack);
  }
  console.error("=".repeat(60));
  console.error("");

  // Generate crash report
  try {
    const reportPath = generateCrashReport(workspaceRoot, report);
    console.error(`[CRASH] Crash report written to ${reportPath}`);
  } catch (reportErr) {
    console.error(`[CRASH] Failed to write crash report: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`);
  }

  console.error("[CRASH] Process terminating with exit code 1.");
}

// ─── Handler installation ─────────────────────────────────────────────────────────

/**
 * Install top-level process crash handlers for `uncaughtException` and
 * `unhandledRejection`.
 *
 * This function:
 * - Registers handlers that log the error, generate a crash report, and exit with code 1
 * - Uses a module-level `installed` flag to prevent double-registration
 * - Uses a 1-second debounce to prevent rapid re-entry from cascading errors
 * - Calls `process.exit(1)` unconditionally — NO restart/retry logic
 *
 * Call this at the very top of the main entry point, before any other initialization.
 *
 * @param workspaceRoot - The project root directory for crash report output.
 *   Defaults to `process.cwd()`.
 */
export function installProcessCrashHandler(workspaceRoot?: string): void {
  // Prevent double-registration
  if (installed) {
    return;
  }
  installed = true;

  const root = workspaceRoot ?? process.cwd();

  // ── uncaughtException handler ──────────────────────────────────────────────
  uncaughtHandler = (err: Error) => {
    const now = Date.now();

    // Debounce: if the last crash was less than DEBOUNCE_MS ago, skip
    if (now - lastCrashTime < DEBOUNCE_MS) {
      // Still exit — we just don't re-run the full handler
      process.exit(1);
      return;
    }
    lastCrashTime = now;

    const report: CrashReport = {
      timestamp: new Date().toISOString(),
      message: err.message ?? String(err),
      stack: err.stack,
      crashType: "uncaughtException",
      nodeVersion: process.version,
      argv: process.argv,
      cwd: process.cwd(),
      platform: process.platform,
    };

    gracefulShutdown(root, report);

    // Exit with non-zero code — NO restart/retry logic.
    // This is intentional: restarting from a crash handler can mask bugs,
    // cause infinite restart loops, and lose the original error context.
    // The user should inspect the crash report and fix the underlying issue.
    process.exit(1);
  };

  // ── unhandledRejection handler ─────────────────────────────────────────────
  unhandledHandler = (reason: unknown) => {
    const now = Date.now();

    // Debounce: if the last crash was less than DEBOUNCE_MS ago, skip
    if (now - lastCrashTime < DEBOUNCE_MS) {
      process.exit(1);
      return;
    }
    lastCrashTime = now;

    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
        ? reason
        : `Unhandled rejection: ${String(reason)}`;

    const stack = reason instanceof Error ? reason.stack : undefined;

    const report: CrashReport = {
      timestamp: new Date().toISOString(),
      message,
      stack,
      crashType: "unhandledRejection",
      nodeVersion: process.version,
      argv: process.argv,
      cwd: process.cwd(),
      platform: process.platform,
    };

    gracefulShutdown(root, report);

    // Exit with non-zero code — NO restart/retry logic (same rationale as above)
    process.exit(1);
  };

  process.on("uncaughtException", uncaughtHandler);
  process.on("unhandledRejection", unhandledHandler);
}

/**
 * Check whether the crash handler has been installed.
 * Useful for tests to verify installation without side effects.
 */
export function isCrashHandlerInstalled(): boolean {
  return installed;
}

/**
 * Reset the installed flag (for testing purposes only).
 * This allows tests to verify installation behavior without leaking state.
 */
export function resetCrashHandlerState(): void {
  installed = false;
  lastCrashTime = 0;
  if (uncaughtHandler) {
    process.removeListener("uncaughtException", uncaughtHandler);
    uncaughtHandler = undefined;
  }
  if (unhandledHandler) {
    process.removeListener("unhandledRejection", unhandledHandler);
    unhandledHandler = undefined;
  }
}
