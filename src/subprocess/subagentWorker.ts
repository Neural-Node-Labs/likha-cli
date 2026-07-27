/**
 * subagentWorker.ts — Entry point for subagent child processes.
 *
 * This script is spawned via `child_process.fork()` by SubprocessManager.
 * It receives task configuration via IPC, executes the subagent logic,
 * sends periodic heartbeat pings to the parent, and reports the result.
 *
 * Protocol:
 * 1. Parent sends { type: "start", data: { task, ... } } via IPC
 * 2. Worker sends { type: "heartbeat" } every 2s
 * 3. Worker sends { type: "result", data: <result> } on success, then exits 0
 * 4. Worker sends { type: "error", data: <error> } on failure, then exits 1
 * 5. Uncaught exceptions / unhandled rejections are caught and reported as errors
 */

// ─── Heartbeat ────────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 2_000;

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    try {
      if (process.send) {
        process.send({ type: "heartbeat" });
      }
    } catch {
      stopHeartbeat();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

// ─── Error handling ───────────────────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  sendError(`Uncaught exception: ${message}`);
  stopHeartbeat();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  sendError(`Unhandled rejection: ${message}`);
  stopHeartbeat();
  process.exit(1);
});

// ─── Message handler ──────────────────────────────────────────────────────────────

process.on("message", async (msg: unknown) => {
  const message = msg as Record<string, unknown>;

  if (message?.type !== "start") {
    return;
  }

  const workerData = message.data as Record<string, unknown> | undefined;
  if (!workerData) {
    sendError("No worker data received");
    process.exit(1);
    return;
  }

  const task = workerData.task as string | undefined;
  if (!task) {
    sendError("No task provided in worker data");
    process.exit(1);
    return;
  }

  startHeartbeat();

  try {
    const result = await executeSubagentTask(workerData);
    stopHeartbeat();

    if (process.send) {
      process.send({ type: "result", data: result });
    }

    process.exit(0);
  } catch (err) {
    stopHeartbeat();
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    sendError(`Subagent execution failed: ${message}`);
    process.exit(1);
  }
});

// ─── Helper functions ─────────────────────────────────────────────────────────────

function sendError(message: string): void {
  try {
    if (process.send) {
      process.send({ type: "error", data: message });
    }
  } catch {
    // Parent may have disconnected
  }
}

/**
 * Execute the subagent task in this isolated process.
 * Imports the orchestrator and runs the task with the provided configuration.
 */
async function executeSubagentTask(workerData: Record<string, unknown>): Promise<unknown> {
  const task = workerData.task as string;
  const maxIterations = (workerData.maxIterations as number) ?? 20;
  const cwd = (workerData.cwd as string) ?? process.cwd();
  const projectRoot = (workerData.projectRoot as string) ?? cwd;

  // Dynamic import of the orchestrator — this is the actual subagent logic
  const { ReActOrchestrator } = await import("../core/orchestrator.js");
  const { AutoIO } = await import("../core/io/AutoIO.js");
  const { DeepSeekClient } = await import("../llm/deepseekClient.js");

  // Reconstruct LLM config from serialized data
  const llmConfig = workerData.llmConfig as Record<string, unknown> | undefined;
  const config = llmConfig
    ? {
        provider: String(llmConfig.provider ?? "deepseek"),
        base_url: llmConfig.base_url ? String(llmConfig.base_url) : "https://api.deepseek.com/v1",
        endpoint: llmConfig.endpoint ? String(llmConfig.endpoint) : "/chat/completions",
        model: String(llmConfig.model ?? "deepseek-v4-flash"),
        api_key_env: String(llmConfig.api_key_env ?? "DEEPSEEK_API_KEY"),
        max_tokens: Number(llmConfig.max_tokens ?? 16384),
        temperature: Number(llmConfig.temperature ?? 0.0),
        thinking: Boolean(llmConfig.thinking ?? false),
      }
    : {
        provider: "deepseek",
        base_url: "https://api.deepseek.com/v1",
        endpoint: "/chat/completions",
        model: "deepseek-v4-flash",
        api_key_env: "DEEPSEEK_API_KEY",
        max_tokens: 16384,
        temperature: 0.0,
        thinking: false,
      };

  // Create telemetry
  const telemetry = createNoopTelemetry();

  const llm = new DeepSeekClient(config, telemetry);

  const sub = new ReActOrchestrator(llm, telemetry, {
    cwd,
    projectRoot,
    maxIterations,
    consoleIndent: (workerData.consoleIndent as number) ?? 1,
    singlePhase: true,
    io: new AutoIO(),
    validateGoal: false,
    selfHealing: workerData.selfHealing !== false,
  });

  const result = await sub.run(task, { skipPlanMode: true, isSubagent: true });

  return {
    status: sub.getLastOutcome() === "completed" ? "completed" : "iteration_limit",
    summary: result,
    iterationCount: sub.getIterationCount(),
    usage: sub.getCumulativeUsage(),
    partialOutput: sub.getLastOutcome() !== "completed"
      ? extractPartialContext(sub)
      : undefined,
  };
}

/**
 * Extract accumulated context from a subagent that hit its iteration limit.
 */
function extractPartialContext(sub: { getLastMessages(): unknown[] }): {
  lastThought: string;
  toolCalls: string[];
  observations: string[];
} {
  const messages = sub.getLastMessages() as Array<{
    role: string;
    content?: string;
    tool_calls?: Array<{ function: { name: string; arguments: string } }>;
  }>;

  const toolCalls: string[] = [];
  const observations: string[] = [];
  let lastThought = "";

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.content) {
      lastThought = msg.content;
    }
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        try {
          const args = JSON.parse(tc.function.arguments);
          const argSummary = Object.keys(args).length > 0
            ? `(${Object.entries(args).map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(", ")})`
            : "";
          toolCalls.push(`${tc.function.name} ${argSummary}`);
        } catch {
          toolCalls.push(tc.function.name);
        }
      }
    }
    if (msg.role === "tool" && msg.content) {
      observations.push(String(msg.content).slice(0, 200));
    }
  }

  return { lastThought, toolCalls, observations };
}

/**
 * Create a no-op telemetry instance for the subagent process.
 * The subagent runs in isolation and doesn't share telemetry with the parent.
 */
function createNoopTelemetry() {
  return {
    logThought: async () => {},
    logLlmCall: async () => {},
    logError: async () => {},
  };
}
