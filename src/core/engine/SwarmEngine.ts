import fs from "node:fs";
import path from "node:path";
import {
  LlmClient,
  LlmMessage,
  LlmUsage,
  TelemetryInterface,
  ToolSchema,
  ToolCall,
  LoadedSkill,
  ReActStep,
} from "../types.js";
import { TOOL_SCHEMAS } from "../../tools/toolSchemas.js";
import { dispatchToolCall } from "../../tools/toolDispatcher.js";
import { SkillRegistry } from "../skillRegistry.js";
import { buildProtocolPrompt } from "../protocol.js";
import { validateGoal, buildObservationTranscript } from "../goalValidator.js";
import { createHealthState, scoreStep, rollingHealth, HealthState } from "../stepScorer.js";
import { AgentIO } from "../io/AgentIO.js";
import { AutoIO } from "../io/AutoIO.js";
import { LeanEngine } from "./LeanEngine.js";
import {
  IReactEngine,
  IReactEngineV2,
  RunOptions,
  RunOutcome,
  PartialSuccessContext,
  SubagentLimitContext,
  EngineState,
  EngineError,
  ProgressObserver,
} from "./IReactEngine.js";

// ─── Constants ────────────────────────────────────────────────────────────────────

/** Default timeout (ms) for a single swarm agent task. 5 minutes. */
const DEFAULT_AGENT_TIMEOUT_MS = 300_000;

/** Max consecutive failures for a single task before the circuit breaker trips. */
const CIRCUIT_BREAKER_THRESHOLD = 3;

/** Cooldown iterations between self-healing nudges. */
const NUDGE_COOLDOWN = 3;

// ─── Options & Interfaces ────────────────────────────────────────────────────────

export interface SwarmEngineOptions {
  maxIterations?: number;
  cwd?: string;
  tools?: ToolSchema[];
  systemPrompt?: string;
  validateGoal?: boolean;
  maxValidatorRetries?: number;
  selfHealing?: boolean;
  consoleThoughts?: boolean;
  io?: AgentIO;
  /** Max parallel swarm agents to run concurrently. Default: 5 */
  maxParallelAgents?: number;
  /** Max iterations per swarm agent. Default: 15 */
  swarmAgentMaxIterations?: number;
  /** Whether to persist WBS and phase reports to disk. Default: true */
  persistArtifacts?: boolean;
  /** Timeout (ms) for each swarm agent task. Default: 300000 (5 min) */
  agentTimeoutMs?: number;
}

export interface WbsTask {
  id: string;
  description: string;
  details: string;
  dependencies: string[];
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  result?: string;
  agentId?: string;
  iterationCount?: number;
  error?: string;
  /** Circuit breaker: consecutive failure count for this task. */
  consecutiveFailures?: number;
}

interface SwarmAgentResult {
  taskId: string;
  status: "completed" | "failed" | "iteration_limit";
  summary: string;
  iterationCount: number;
  error?: string;
}

interface ValidationReport {
  iteration: number;
  score: number;
  verdict: "pass" | "warn" | "fail";
  issues: string[];
  recommendations: string[];
  healthScore: number;
}

// ─── SwarmEngine Implementation ──────────────────────────────────────────────────

export class SwarmEngine implements IReactEngine, IReactEngineV2 {
  private llm: LlmClient;
  private telemetry: TelemetryInterface;
  private opts: SwarmEngineOptions;
  private registry = new SkillRegistry();
  private io: AgentIO;
  private cwd: string;

  // Lifecycle state
  private state: EngineState = { phase: "idle" };
  private observers: Set<ProgressObserver> = new Set();
  private cancelled = false;

  // Run tracking
  private cumulativeUsage: LlmUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
  };
  private llmCallCount = 0;
  private iterationCount = 0;
  private lastOutcome: RunOutcome = "completed";
  private lastMessages: LlmMessage[] = [];
  private health: HealthState = createHealthState();
  private lastNudgeIteration = -Infinity;

  // WBS state
  private wbsTasks: WbsTask[] = [];
  private wbsPath = "";

  // Validation history
  private validationHistory: ValidationReport[] = [];

  // Partial success tracking
  private partialSuccess?: PartialSuccessContext;
  private subagentLimitContext?: SubagentLimitContext;

  constructor(llm: LlmClient, telemetry: TelemetryInterface, opts: SwarmEngineOptions = {}) {
    this.llm = llm;
    this.telemetry = telemetry;
    this.opts = opts;
    this.cwd = opts.cwd ?? process.cwd();
    this.io = opts.io ?? new AutoIO();
  }

  // ─── Helpers & Utility ─────────────────────────────────────────────────────────

  private transition(nextState: EngineState): void {
    this.state = nextState;
    for (const obs of this.observers) {
      try {
        obs(nextState);
      } catch (err) {
        // ignore observer errors
      }
    }
  }

  private addUsage(usage?: LlmUsage): void {
    if (!usage) return;
    this.llmCallCount += 1;
    this.cumulativeUsage.promptTokens += usage.promptTokens || 0;
    this.cumulativeUsage.completionTokens += usage.completionTokens || 0;
    this.cumulativeUsage.totalTokens += usage.totalTokens || 0;
    this.cumulativeUsage.reasoningTokens = (this.cumulativeUsage.reasoningTokens || 0) + (usage.reasoningTokens || 0);
    this.cumulativeUsage.cachedTokens = (this.cumulativeUsage.cachedTokens || 0) + (usage.cachedTokens || 0);
  }

  private getTaskFromState(): string {
    if ("task" in this.state) return (this.state as any).task;
    return "";
  }

  // ─── IReactEngineV2 implementation ──────────────────────────────────────────────

  cancel(reason?: string): void {
    if (this.state.phase === "idle" || this.state.phase === "completed" || this.state.phase === "cancelled") {
      return;
    }
    this.cancelled = true;
    this.transition({ phase: "cancelled", task: this.getTaskFromState(), reason: reason ?? "cancelled by caller" });
  }

  onProgress(observer: ProgressObserver): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  getState(): EngineState {
    return this.state;
  }

  getLastMessages(): LlmMessage[] {
    return this.lastMessages;
  }

  getWorkspacePath(): string {
    return this.cwd;
  }

  getIterationCount(): number {
    return this.iterationCount;
  }

  // ─── IReactEngine implementation ────────────────────────────────────────────────

  getLastOutcome(): RunOutcome {
    return this.lastOutcome;
  }

  getCumulativeUsage(): LlmUsage {
    return { ...this.cumulativeUsage };
  }

  getHealthScore(window = 5): number {
    return rollingHealth(this.health, window);
  }

  getPartialSuccess(): PartialSuccessContext | undefined {
    return this.partialSuccess;
  }

  getSubagentLimitContext(): SubagentLimitContext | undefined {
    return this.subagentLimitContext;
  }

  selectSkills(taskDescription: string): LoadedSkill[] {
    const headers = this.registry.route(taskDescription);
    const primary = headers[0];
    if (!primary) return [];

    const names = new Set<string>([primary.name, ...primary.composes_with]);
    return [...names]
      .map((n) => this.registry.loadSkill(n))
      .filter((s): s is LoadedSkill => Boolean(s));
  }

  async generatePlan(taskDescription: string): Promise<string> {
    const skills = this.selectSkills(taskDescription);
    const skillContext = skills.length
      ? `\n\nThe following specialized skills are relevant to this task:\n\n${skills
          .map((s) => `## ${s.header.name} (${s.header.role})\n${s.body}`)
          .join("\n\n")}`
      : "";

    const planPrompt: LlmMessage[] = [
      {
        role: "system",
        content:
          buildProtocolPrompt(this.cwd) +
          "You are in Plan Mode for a Swarm Orchestration Engine. Do not call any tools. " +
          "Produce a detailed Work Breakdown Structure (WBS) for the task below. " +
          "Each WBS item must be a self-contained unit of work that a swarm agent can execute independently.\n" +
          "Format as a markdown table with columns: ID | Description | Dependencies | Instructions" +
          skillContext,
      },
      { role: "user", content: taskDescription },
    ];

    const response = await this.llm.complete(planPrompt);
    this.addUsage(response.usage);
    return `# Swarm Plan: ${taskDescription}\n\n${response.content.trim()}\n`;
  }

  // ─── Main Run Loop ──────────────────────────────────────────────────────────────

  async run(taskDescription: string, runOpts: RunOptions = {}): Promise<string> {
    // ── Input validation ────────────────────────────────────────────────────────
    if (!taskDescription || typeof taskDescription !== "string" || taskDescription.trim().length === 0) {
      throw new Error("SwarmEngine.run() requires a non-empty taskDescription string.");
    }

    this.cancelled = false;
    this.lastOutcome = "completed";
    this.iterationCount = 0;
    this.lastMessages = [];
    this.health = createHealthState();
    this.lastNudgeIteration = -Infinity;
    this.partialSuccess = undefined;
    this.subagentLimitContext = undefined;
    this.wbsTasks = [];
    this.validationHistory = [];

    const skills = this.selectSkills(taskDescription);
    const maxIterations = this.opts.maxIterations ?? 30;
    const selfHealingOn = this.opts.selfHealing !== false;

    this.transition({ phase: "running", task: taskDescription, iteration: 0, maxIterations });

    if (skills.length === 0) {
      this.io.log("No matching skill found for this task. Proceeding with SwarmEngine base loop.");
    } else {
      this.io.log(`Loaded skills: ${skills.map((s) => s.header.name).join(", ")}`);
    }

    // Phase 1: Planning
    this.io.log("\n═══════════════════════════════════════════");
    this.io.log("  SWARM ENGINE — Phase 1: Planning (WBS)");
    this.io.log("═══════════════════════════════════════════\n");

    const wbsPlan = await this.generateWbs(taskDescription, skills);
    this.io.log(wbsPlan);

    this.wbsTasks = this.parseWbsTasks(wbsPlan);
    if (this.wbsTasks.length === 0) {
      this.io.log("WARNING: No tasks could be parsed from WBS plan. Falling back to single-agent mode.");
      return await this.runSingleAgent(taskDescription, skills, runOpts);
    }

    // Validate WBS dependencies (detect circular dependencies)
    const cycleErrors = this.validateWbsDependencies();
    if (cycleErrors.length > 0) {
      this.io.log(`WARNING: Circular dependencies detected in WBS:\n${cycleErrors.join("\n")}`);
      this.io.log("Falling back to single-agent mode due to invalid WBS dependencies.");
      return await this.runSingleAgent(taskDescription, skills, runOpts);
    }

    this.io.log(`\n📋 WBS: ${this.wbsTasks.length} tasks identified`);
    this.io.log(`   ${this.wbsTasks.filter((t) => t.dependencies.length === 0).length} parallel-ready tasks`);

    if (this.opts.persistArtifacts !== false) {
      this.writeWbsToDisk(taskDescription);
    }

    // Phase 2: Orchestration Loop
    this.io.log("\n═══════════════════════════════════════════");
    this.io.log("  SWARM ENGINE — Phase 2: Orchestration");
    this.io.log("═══════════════════════════════════════════\n");

    const messages: LlmMessage[] = [
      { role: "system", content: this.buildSwarmSystemPrompt(skills, taskDescription) },
      { role: "user", content: this.buildOrchestratorPrompt(taskDescription) },
    ];

    let finalContent = "";
    const swarmTools = this.getSwarmTools();

    while (this.iterationCount < maxIterations && !this.cancelled) {
      this.iterationCount++;
      this.transition({ phase: "running", task: taskDescription, iteration: this.iterationCount, maxIterations });

      // Execute auto-dispatch for ready parallel tasks (with cancellation check)
      if (!this.cancelled) {
        await this.dispatchReadyTasks();
      }

      // ── Orchestrator LLM call with error handling ──
      let response;
      try {
        response = await this.llm.complete(messages, { tools: swarmTools });
      } catch (err) {
        await this.telemetry.logError(err, `SwarmEngine orchestrator LLM call failed at iteration ${this.iterationCount}`);
        this.transition({
          phase: "error",
          task: taskDescription,
          error: { type: "llm", message: err instanceof Error ? err.message : String(err), retryable: true },
        });
        this.lastOutcome = "partial_success";
        this.lastMessages = messages;
        return `Swarm execution failed: orchestrator LLM error at iteration ${this.iterationCount}. ${err instanceof Error ? err.message : String(err)}`;
      }

      this.addUsage(response.usage);

      messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });
      finalContent = response.content || finalContent;

      if (this.opts.consoleThoughts !== false && response.content) {
        this.io.thought(response.content);
      }

      // Handle Orchestrator Tool Calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const toolCall of response.tool_calls) {
          const resultStr = await this.handleSwarmToolCall(toolCall);

          // Score the step for health tracking
          if (selfHealingOn) {
            const isError = resultStr.startsWith("Error:");
            const { score } = scoreStep(this.health, {
              tool: toolCall.name,
              args: toolCall.arguments,
              observation: resultStr,
              isError,
            });
            if (this.opts.consoleThoughts !== false) {
              this.io.observation(resultStr, isError, undefined, score);
            }
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: resultStr,
          });
        }
      } else {
        // If the orchestrator stopped making tool calls, evaluate status
        const allDone = this.wbsTasks.every((t) => t.status === "completed" || t.status === "failed" || t.status === "skipped");
        if (allDone) {
          break;
        } else {
          messages.push({
            role: "user",
            content: "SYSTEM NUDGE: Unfinished WBS tasks remain. Please assign pending tasks or update status.",
          });
        }
      }

      // ── Self-healing nudge ──
      if (selfHealingOn) {
        const avgHealth = rollingHealth(this.health);
        const cooldownPassed = this.iterationCount - this.lastNudgeIteration >= NUDGE_COOLDOWN;
        if (avgHealth < 40 && cooldownPassed && this.health.scores.length >= 2) {
          this.lastNudgeIteration = this.iterationCount;
          this.io.healthWarning(avgHealth);
          messages.push({
            role: "user",
            content:
              `[self-check] The orchestrator's recent actions haven't been making much progress (rolling health score: ${avgHealth}/100 — errors and/or repeated identical actions with no new information). ` +
              `Before continuing: re-read the current state of the WBS tasks rather than assuming, double-check your last assumption was actually correct, and consider a genuinely different approach instead of retrying something similar.`,
          });
        }
      }

      // Goal Validator check
      if (this.opts.validateGoal !== false) {
        await this.runGoalValidator(taskDescription);
      }
    }

    this.lastMessages = messages;

    if (this.cancelled) {
      this.lastOutcome = "partial_success";
      this.extractPartialSuccessContext(messages, this.iterationCount, 0);
      this.transition({ phase: "cancelled", task: taskDescription, reason: "Cancelled during execution" });
      return finalContent || "Execution cancelled by caller.";
    }

    const uncompleted = this.wbsTasks.filter((t) => t.status !== "completed");
    if (uncompleted.length > 0) {
      this.lastOutcome = "iteration_limit";
      this.extractPartialSuccessContext(messages, this.iterationCount, 0);
      finalContent = await this.synthesizeReport(taskDescription, messages, finalContent, maxIterations, 0);
    }

    if (this.state.phase !== "cancelled") {
      this.transition({ phase: "completed", task: taskDescription, outcome: this.lastOutcome });
    }

    if (this.opts.consoleThoughts !== false && this.health.scores.length > 0) {
      this.io.log(`📈 Final health score: ${this.getHealthScore()}/100 (${this.health.scores.length} scored steps)`);
    }

    return finalContent;
  }

  // ─── WBS Generation ────────────────────────────────────────────────────────────

  private async generateWbs(taskDescription: string, skills: LoadedSkill[]): Promise<string> {
    const skillContext = skills.length
      ? `\n\nThe following specialized skills are relevant to this task:\n\n${skills
          .map((s) => `## ${s.header.name} (${s.header.role})\n${s.body}`)
          .join("\n\n")}`
      : "";

    const wbsPrompt: LlmMessage[] = [
      {
        role: "system",
        content:
          buildProtocolPrompt(this.cwd) +
          "You are a Work Breakdown Structure (WBS) planner for a Swarm Orchestration Engine. " +
          "Produce a detailed WBS for the task below. Each WBS item must be a self-contained unit of work " +
          "that a swarm agent can execute independently. " +
          "Format as a markdown table with columns: ID | Description | Dependencies | Instructions. " +
          "Use IDs like T1, T2, T3, etc. Dependencies should be comma-separated IDs or 'None'. " +
          "Include at least 2-5 tasks that decompose the work into parallelizable units." +
          skillContext,
      },
      { role: "user", content: taskDescription },
    ];

    const response = await this.llm.complete(wbsPrompt);
    this.addUsage(response.usage);
    return response.content.trim();
  }

  private parseWbsTasks(wbsPlan: string): WbsTask[] {
    const lines = wbsPlan.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const tasks: WbsTask[] = [];
    let inTable = false;

    for (const line of lines) {
      if (line.startsWith("|") && line.endsWith("|")) {
        if (line.includes("---")) continue;
        const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
        if (cells.length >= 3) {
          const id = cells[0].trim();
          const description = cells[1]?.trim() || "";
          const depsRaw = cells[2]?.trim() || "";
          const details = cells.slice(3).join(" | ").trim();
          if (id.toLowerCase() === "id") continue;
          const dependencies = depsRaw.toLowerCase() === "none" || depsRaw === ""
            ? []
            : depsRaw.split(",").map((d) => d.trim()).filter((d) => d.length > 0);
          tasks.push({
            id,
            description,
            details,
            dependencies,
            status: "pending",
            consecutiveFailures: 0,
          });
        }
        inTable = true;
      } else if (inTable) {
        break;
      }
    }
    return tasks;
  }

  private validateWbsDependencies(): string[] {
    const errors: string[] = [];
    const adj = new Map<string, string[]>();
    for (const task of this.wbsTasks) adj.set(task.id, task.dependencies);

    for (const task of this.wbsTasks) {
      if (task.dependencies.includes(task.id)) {
        errors.push(`Task ${task.id} has a self-referential dependency.`);
      }
    }

    const allIds = new Set(this.wbsTasks.map((t) => t.id));
    for (const task of this.wbsTasks) {
      for (const dep of task.dependencies) {
        if (!allIds.has(dep)) {
          errors.push(`Task ${task.id} depends on unknown task ${dep}.`);
        }
      }
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const dfs = (node: string): boolean => {
      if (inStack.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      inStack.add(node);
      for (const dep of adj.get(node) || []) {
        if (dfs(dep)) return true;
      }
      inStack.delete(node);
      return false;
    };

    for (const task of this.wbsTasks) {
      if (!visited.has(task.id) && dfs(task.id)) {
        errors.push(`Circular dependency detected involving task ${task.id}.`);
      }
    }
    return errors;
  }

  private async dispatchReadyTasks(): Promise<void> {
    const readyTasks = this.wbsTasks.filter(
      (t) => t.status === "pending" && t.dependencies.every((dep) => {
        const dt = this.wbsTasks.find((wt) => wt.id === dep);
        return dt && dt.status === "completed";
      })
    );
    if (readyTasks.length === 0) return;

    const maxParallel = this.opts.maxParallelAgents ?? 5;
    const batch = readyTasks.slice(0, maxParallel);
    this.io.log(`\n🚀 Dispatching ${batch.length} ready task(s): ${batch.map((t) => t.id).join(", ")}`);

    for (const task of batch) task.status = "in_progress";

    const results = await Promise.allSettled(
      batch.map(async (task) => {
        const agentTimeout = this.opts.agentTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
        const agentMaxIterations = this.opts.swarmAgentMaxIterations ?? 15;
        const agentInstructions = task.details
          ? `Task ${task.id}: ${task.description}\n\nInstructions: ${task.details}`
          : `Task ${task.id}: ${task.description}`;

        const agent = new LeanEngine(this.llm, this.telemetry, {
          maxIterations: agentMaxIterations,
          cwd: this.cwd,
          validateGoal: false,
          selfHealing: false,
          consoleThoughts: false,
        });

        const timeoutPromise = new Promise<{ status: "failed"; summary: string; error: string }>((_, reject) => {
          setTimeout(() => reject(new Error(`Task ${task.id} timed out after ${agentTimeout}ms`)), agentTimeout);
        });

        const runPromise = agent.run(agentInstructions).then((summary) => ({
          status: agent.getLastOutcome() === "completed" ? "completed" as const : "iteration_limit" as const,
          summary,
          iterationCount: agent.getIterationCount(),
        }));

        return await Promise.race([runPromise, timeoutPromise]) as any;
      })
    );

    for (let i = 0; i < batch.length; i++) {
      const task = batch[i];
      const result = results[i];
      if (result.status === "fulfilled") {
        const ar = result.value;
        task.status = ar.status === "completed" ? "completed" : "failed";
        task.result = ar.summary;
        task.iterationCount = ar.iterationCount || 0;
        task.consecutiveFailures = ar.status === "completed" ? 0 : (task.consecutiveFailures || 0) + 1;
        this.io.log(`  ${task.status === "completed" ? "✅" : "⚠️"} Task ${task.id} ${task.status === "completed" ? "completed" : "hit iteration limit"} (${ar.iterationCount || "?"} iterations)`);
      } else {
        const error = result.reason?.message || String(result.reason || "Unknown error");
        task.status = "failed";
        task.error = error;
        task.consecutiveFailures = (task.consecutiveFailures || 0) + 1;
        this.io.log(`  ❌ Task ${task.id} failed: ${error}`);
        if (task.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          task.status = "skipped";
          this.io.log(`  🔇 Task ${task.id} skipped (circuit breaker: ${task.consecutiveFailures} consecutive failures)`);
        }
      }
    }
  }

  private async runSingleAgent(taskDescription: string, skills: LoadedSkill[], runOpts: RunOptions): Promise<string> {
    this.io.log("\n═══════════════════════════════════════════");
    this.io.log("  SWARM ENGINE — Fallback: Single-Agent Mode");
    this.io.log("═══════════════════════════════════════════\n");

    const agent = new LeanEngine(this.llm, this.telemetry, {
      maxIterations: this.opts.maxIterations ?? 30,
      cwd: this.cwd,
      validateGoal: this.opts.validateGoal,
      maxValidatorRetries: this.opts.maxValidatorRetries,
      selfHealing: this.opts.selfHealing,
      consoleThoughts: this.opts.consoleThoughts,
      io: this.io,
    });

    const result = await agent.run(taskDescription, runOpts);
    this.lastOutcome = agent.getLastOutcome();
    this.lastMessages = agent.getLastMessages();
    this.cumulativeUsage = agent.getCumulativeUsage() || this.cumulativeUsage;
    this.iterationCount = agent.getIterationCount();
    this.partialSuccess = agent.getPartialSuccess();
    return result;
  }

  // ─── Orchestrator Prompt Building ──────────────────────────────────────────────

  private buildSwarmSystemPrompt(skills: LoadedSkill[], taskDescription: string): string {
    const protocol = buildProtocolPrompt(this.cwd);
    const base =
      "You are the Orchestrating Agent in a Swarm Engine. Your role is to coordinate multiple " +
      "swarm agents to complete a complex task in parallel.\n\n" +
      "You have the following swarm management tools:\n" +
      "- swarm_assign_tool: Assign a WBS task to a swarm agent for execution\n" +
      "- swarm_status_tool: Check the status of all WBS tasks\n" +
      "- swarm_result_tool: Get the result of a completed WBS task\n" +
      "- swarm_retry_tool: Retry a failed WBS task\n" +
      "- swarm_cancel_tool: Cancel a running WBS task\n" +
      "- swarm_report_tool: Generate a summary report of all tasks\n\n" +
      "The WBS has already been created. Your job is to:\n" +
      "1. Assign pending tasks to swarm agents using swarm_assign_tool\n" +
      "2. Monitor task progress using swarm_status_tool\n" +
      "3. Handle failures by retrying or reassigning tasks\n" +
      "4. When all tasks are complete, call swarm_report_tool to generate the final report\n\n" +
      "Tasks with no dependencies are automatically dispatched in parallel. " +
      "You only need to manage tasks that require orchestration decisions.";

    const skillBlocks = skills.length
      ? `\n\nThe following specialized skill directives are loaded for this task:\n\n${skills
          .map((s) => `## Skill: ${s.header.name} (${s.header.role})\n${s.body}`)
          .join("\n\n")}`
      : "";

    return `${protocol}<task_context>\n${base}${skillBlocks}\n</task_context>`;
  }

  private buildOrchestratorPrompt(taskDescription: string): string {
    const taskSummary = this.wbsTasks
      .map((t) => {
        const deps = t.dependencies.length > 0 ? t.dependencies.join(", ") : "None";
        return `- ${t.id}: ${t.description} [deps: ${deps}] [status: ${t.status}]`;
      })
      .join("\n");
    return `Task: ${taskDescription}\n\nCurrent WBS State:\n${taskSummary}\n\nPlease manage the swarm agents to complete this task. Use the swarm tools to assign, monitor, and report on task progress.`;
  }

  private getSwarmTools(): ToolSchema[] {
    return [
      {
        type: "function",
        function: {
          name: "swarm_assign_tool",
          description: "Assign a WBS task to a swarm agent for execution.",
          parameters: {
            type: "object",
            properties: { taskId: { type: "string", description: "The WBS task ID to assign" } },
            required: ["taskId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "swarm_status_tool",
          description: "Check the current status of all WBS tasks or a specific task.",
          parameters: {
            type: "object",
            properties: { taskId: { type: "string", description: "Optional: specific task ID to check" } },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "swarm_result_tool",
          description: "Get the result of a completed WBS task.",
          parameters: {
            type: "object",
            properties: { taskId: { type: "string", description: "The WBS task ID" } },
            required: ["taskId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "swarm_retry_tool",
          description: "Retry a failed WBS task.",
          parameters: {
            type: "object",
            properties: { taskId: { type: "string", description: "The WBS task ID to retry" } },
            required: ["taskId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "swarm_cancel_tool",
          description: "Cancel a running WBS task.",
          parameters: {
            type: "object",
            properties: { taskId: { type: "string", description: "The WBS task ID to cancel" } },
            required: ["taskId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "swarm_report_tool",
          description: "Generate a final summary report of all WBS tasks.",
          parameters: {
            type: "object",
            properties: { includeDetails: { type: "boolean", description: "Whether to include detailed results" } },
          },
        },
      },
    ];
  }

  private async handleSwarmToolCall(toolCall: ToolCall): Promise<string> {
    const name = toolCall.function.name;
    let args: Record<string, any> = {};
    try { args = JSON.parse(toolCall.function.arguments); } catch { return `Error: Failed to parse arguments for ${name}: ${toolCall.function.arguments}`; }

    switch (name) {
      case "swarm_assign_tool": {
        const taskId = args.taskId;
        const task = this.wbsTasks.find((t) => t.id === taskId);
        if (!task) return `Error: Task ${taskId} not found in WBS.`;
        if (task.status !== "pending") return `Error: Task ${taskId} is already ${task.status}. Cannot assign.`;
        const unmetDeps = task.dependencies.filter((dep) => {
          const dt = this.wbsTasks.find((t) => t.id === dep);
          return !dt || dt.status !== "completed";
        });
        if (unmetDeps.length > 0) return `Error: Task ${taskId} has unmet dependencies: ${unmetDeps.join(", ")}. Complete those first.`;
        task.status = "in_progress";
        this.dispatchReadyTasks();
        return `Task ${taskId} assigned and dispatched to swarm agent.`;
      }
      case "swarm_status_tool": {
        if (args.taskId) {
          const task = this.wbsTasks.find((t) => t.id === args.taskId);
          if (!task) return `Error: Task ${args.taskId} not found.`;
          return `Task ${task.id}: ${task.description} [status: ${task.status}]${task.error ? " [error: " + task.error + "]" : ""}`;
        }
        const lines = this.wbsTasks.map((t) => `- ${t.id}: ${t.description} [status: ${t.status}]${t.error ? " [error: " + t.error + "]" : ""}`);
        const completed = this.wbsTasks.filter((t) => t.status === "completed").length;
        const failed = this.wbsTasks.filter((t) => t.status === "failed" || t.status === "skipped").length;
        const pending = this.wbsTasks.filter((t) => t.status === "pending" || t.status === "in_progress").length;
        return `WBS Status: ${completed} completed, ${failed} failed/skipped, ${pending} pending/in_progress\n${lines.join("\n")}`;
      }
      case "swarm_result_tool": {
        const task = this.wbsTasks.find((t) => t.id === args.taskId);
        if (!task) return `Error: Task ${args.taskId} not found.`;
        if (task.status !== "completed") return `Task ${args.taskId} is not completed yet (status: ${task.status}).`;
        return `Result for ${task.id}: ${task.description}\n${task.result || "(no result recorded)"}`;
      }
      case "swarm_retry_tool": {
        const task = this.wbsTasks.find((t) => t.id === args.taskId);
        if (!task) return `Error: Task ${args.taskId} not found.`;
        if (task.status !== "failed" && task.status !== "skipped") return `Error: Task ${args.taskId} is ${task.status}, not