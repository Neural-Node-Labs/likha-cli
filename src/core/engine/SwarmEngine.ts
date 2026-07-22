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
    if ("task" in this.state) return this.state.task;
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
   