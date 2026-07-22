/**
 * @file LangGraphEngine.ts
 *
 * LangGraphEngine — a ReAct loop engine built on @langchain/langgraph's StateGraph.
 *
 * ## Overview
 *
 * This engine implements the classic LangGraph ReAct pattern as an explicit
 * two-node state machine using @langchain/langgraph primitives:
 *
 * ```
 *   START ──► agent ──► tools ──► agent ──► tools ──► ... ──► END
 *                │                        ▲
 *                └──── (conditional) ─────┘
 * ```
 *
 * - **agent node**: calls the LLM (`LlmClient.complete()`) with the accumulated
 *   message history and available tool schemas.
 * - **tools node**: dispatches each tool call returned by the LLM via
 *   `dispatchToolCall()` and appends the results back into the message history.
 * - **conditional edge**: if the LLM returns zero tool calls, the graph routes to
 *   END (completion); otherwise it routes back to the tools node, then back to
 *   the agent node.
 *
 * ## Design Philosophy
 *
 * Unlike the hand-rolled `while(true)` loop in `LeanEngine`, this engine uses
 * @langchain/langgraph's `StateGraph` to make the graph structure explicit.
 * The state flows through named nodes, and the routing logic is a single
 * conditional check rather than being interleaved with loop control flow.
 *
 * ## Key Differences from LeanEngine
 *
 * | Aspect | LeanEngine | LangGraphEngine |
 * |--------|-----------|-----------------|
 * | Loop structure | `while(true)` with inline routing | `StateGraph` with explicit nodes + edges |
 * | State management | Local variables in `run()` | `GraphState` annotation passed through nodes |
 * | Extensibility | Add logic inside the loop | Add new nodes with named transitions |
 * | Mental model | Procedural ReAct loop | Graph-based agent cycle |
 *
 * Both engines share the same tool set (`toolSchemas.ts` / `toolDispatcher.ts`),
 * the same `LlmClient`, the same goal validator, health scorer, and I/O
 * abstractions. They are drop-in compatible via the `IReactEngine` /
 * `IReactEngineV2` interfaces.
 *
 * ## Lifecycle
 *
 * The engine tracks its state through a discriminated union (`EngineState`):
 *
 * - `idle` — constructed, not yet running
 * - `running` — actively executing the ReAct loop
 * - `validating` — running the goal validator on a candidate completion
 * - `cancelled` — cancelled by caller via `cancel()`
 * - `completed` — finished normally or with partial success
 * - `error` — unrecoverable error (LLM failure, etc.)
 *
 * Progress observers registered via `onProgress()` receive every state transition.
 *
 * ## Self-Healing
 *
 * When enabled (default), the engine monitors a rolling health score. If the
 * average drops below 40 and at least 3 iterations have passed since the last
 * nudge, it injects a self-check message into the conversation to steer the
 * agent back on track.
 *
 * ## Goal Validation
 *
 * When the LLM produces a final answer (no tool calls), the engine optionally
 * runs an independent goal validator (`validateGoal()`) that checks whether the
 * claimed completion is supported by the recorded observations. If validation
 * fails, the engine feeds the rejection reason back into the conversation and
 * loops back to the agent node for correction. After `maxValidatorRetries`
 * consecutive rejections, the answer is accepted without verification.
 *
 * ## Partial Success & Iteration Limits
 *
 * If the iteration limit is reached without a final answer, the engine:
 * 1. Extracts partial-success context (last N tool calls, files modified/read,
 *    commands run, last thought) via `extractPartialSuccessContext()`.
 * 2. Attempts to call the LLM for a structured summary report via
 *    `callLlmForSummary()`.
 * 3. Falls back to a mechanical reconstruction of the conversation if the LLM
 *    summary call fails.
 *
 * ## Usage
 *
 * ```ts
 * const engine = new LangGraphEngine(llmClient, telemetryService, {
 *   maxIterations: 30,
 *   validateGoal: true,
 *   selfHealing: true,
 *   consoleThoughts: true,
 * });
 *
 * const answer = await engine.run("Refactor the auth module to use JWT");
 * console.log(answer);
 * ```
 *
 * The engine is also registered in `EngineRegistry.ts` under the name `"langgraph"`
 * and can be instantiated via `createEngine("langgraph", deps)`.
 *
 * @module LangGraphEngine
 */

import { Annotation, StateGraph, CompiledStateGraph, START, END, Command } from "@langchain/langgraph";
import { LlmClient, LlmMessage, LlmUsage, TelemetryInterface, ToolSchema, ToolCall, LoadedSkill, ReActStep, Phase } from "../types.js";
import { TOOL_SCHEMAS } from "../../tools/toolSchemas.js";
import { dispatchToolCall } from "../../tools/toolDispatcher.js";
import { SkillRegistry } from "../skillRegistry.js";
import { buildProtocolPrompt } from "../protocol.js";
import { validateGoal, buildObservationTranscript } from "../goalValidator.js";
import { createHealthState, scoreStep, rollingHealth, HealthState } from "../stepScorer.js";
import { AgentIO } from "../io/AgentIO.js";
import { AutoIO } from "../io/AutoIO.js";
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

/** Tools that only read information without side effects. */
const READ_ONLY_TOOLS = new Set(["glob_tool", "grep_tool", "read_tool"]);

/** Tools that make changes to the workspace or external systems. */
const ACTION_TOOLS = new Set(["write_edit_tool", "ssh_tool", "schedule_task_tool", "docker_deploy_ssh_tool"]);

/** Tools that run tests or other validation checks. */
const VALIDATION_TOOLS = new Set(["playwright_run_tool"]);

/** GitHub actions that are read-only (no push/commit). */
const GITHUB_READ_ACTIONS = new Set(["clone", "fetch", "pull", "status"]);

/** Regex matching commands that are considered validation rather than action. */
const VALIDATION_COMMANDS = /\b(test|lint|type-?check|tsc|jest|pytest|kubectl (apply|rollout)|docker build|docker compose|playwright)\b/i;

// ─── Options ──────────────────────────────────────────────────────────────────────

/**
 * Configuration options for the LangGraphEngine.
 *
 * All fields are optional — sensible defaults are applied in the `run()` method.
 */
export interface LangGraphEngineOptions {
  /** Maximum ReAct iterations before the engine stops (default: 20). */
  maxIterations?: number;

  /** Working directory for tool execution (default: `process.cwd()`). */
  cwd?: string;

  /** Tool schemas to expose to the LLM (default: `TOOL_SCHEMAS` from toolSchemas.ts). */
  tools?: ToolSchema[];

  /** Custom system prompt override (default: the xcoder ReAct agent prompt). */
  systemPrompt?: string;

  /** Enable goal validation on candidate completions (default: true). */
  validateGoal?: boolean;

  /** Max retries when goal validation rejects a completion (default: 2). */
  maxValidatorRetries?: number;

  /** Enable self-healing health-score nudges (default: true). */
  selfHealing?: boolean;

  /** Print thoughts, actions, and observations to the console (default: true). */
  consoleThoughts?: boolean;

  /** Custom I/O adapter (default: `AutoIO`). */
  io?: AgentIO;
}

// ─── Graph State Annotation ───────────────────────────────────────────────────────

/**
 * The state that flows through the LangGraph nodes, defined using
 * @langchain/langgraph's Annotation.Root.
 *
 * Mirrors the classic ReAct pattern: messages accumulate as the graph routes
 * between the "agent" node (LLM call) and the "tools" node (tool execution).
 * The `done` flag acts as the conditional edge — when true, the graph terminates.
 */
const GraphStateAnnotation = Annotation.Root({
  /** Accumulated conversation history (system + user + assistant + tool messages). */
  messages: Annotation<LlmMessage[]>({
    reducer: (left, right) => right ?? left,
    default: () => [],
  }),

  /** Current iteration number (1-based). */
  iteration: Annotation<number>({
    reducer: (left, right) => right ?? left,
    default: () => 0,
  }),

  /** Maximum iterations before forced termination. */
  maxIterations: Annotation<number>({
    reducer: (left, right) => right ?? left,
    default: () => 20,
  }),

  /** The final answer text, populated when `done` becomes true. */
  finalAnswer: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),

  /** Termination flag — set to true when the agent produces a final answer. */
  done: Annotation<boolean>({
    reducer: (left, right) => right ?? left,
    default: () => false,
  }),

  /** Number of validator rejections so far. */
  validatorRejections: Annotation<number>({
    reducer: (left, right) => right ?? left,
    default: () => 0,
  }),

  /** Whether the engine has been cancelled. */
  cancelled: Annotation<boolean>({
    reducer: (left, right) => right ?? left,
    default: () => false,
  }),
});

type GraphState = typeof GraphStateAnnotation.StateType;

// ─── Engine ───────────────────────────────────────────────────────────────────────

/**
 * LangGraphEngine — a ReAct loop engine built on @langchain/langgraph's StateGraph.
 *
 * Unlike the hand-rolled loop in LeanEngine or the full ReActOrchestrator, this engine
 * models the agent<->tools cycle as an explicit two-node graph with a conditional edge,
 * the classic LangGraph ReAct tutorial pattern:
 *
 *   START -> agent -> tools -> agent -> tools -> ... -> END
 *              |                    ^
 *              +-- (conditional) ---+
 *
 * The graph is built at construction time and reused across run() calls.
 */
export class LangGraphEngine implements IReactEngine, IReactEngineV2 {
  private llm: LlmClient;
  private telemetry: TelemetryInterface;
  private opts: LangGraphEngineOptions;
  private registry = new SkillRegistry();
  private io: AgentIO;
  private cwd: string;

  // Lifecycle state
  private state: EngineState = { phase: "idle" };
  private observers: Set<ProgressObserver> = new Set();
  private cancelled = false;

  // Run tracking
  private cumulativeUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  private llmCallCount = 0;
  private iterationCount = 0;
  private lastOutcome: RunOutcome = "completed";
  private lastMessages: LlmMessage[] = [];
  private health: HealthState = createHealthState();
  private lastNudgeIteration = -Infinity;

  // Partial success tracking
  private partialSuccess?: PartialSuccessContext;
  private subagentLimitContext?: SubagentLimitContext;

  // The compiled langgraph — built once and reused
  private app: CompiledStateGraph<typeof GraphStateAnnotation, any, any, any> | null = null;

  constructor(
    llm: LlmClient,
    telemetry: TelemetryInterface,
    opts: LangGraphEngineOptions = {}
  ) {
    this.llm = llm;
    this.telemetry = telemetry;
    this.opts = opts;
    this.cwd = opts.cwd ?? process.cwd();
    this.io = opts.io ?? new AutoIO();
  }

  // ─── IReactEngineV2 implementation ──────────────────────────────────────────────

  cancel(reason?: string): void {
    if (this.state.phase === "idle" || this.state.phase === "completed" || this.state.phase === "cancelled") {
      return; // idempotent
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
      ? `\n\nThe following specialized skills are relevant to this task — let their guidance shape the plan's steps:\n\n${skills
          .map((s) => `## ${s.header.name} (${s.header.role})\n${s.body}`)
          .join("\n\n")}`
      : "";

    const planPrompt: LlmMessage[] = [
      {
        role: "system",
        content:
          buildProtocolPrompt(this.cwd) +
          "You are in Plan Mode. Do not call any tools. Produce a short, concrete, checkable " +
          "plan for the task below as a markdown checklist (`- [ ] step`), 3-8 steps. " +
          "No prose outside the checklist." +
          skillContext,
      },
      { role: "user", content: taskDescription },
    ];

    const response = await this.llm.complete(planPrompt);
    this.addUsage(response.usage);
    return `# Plan: ${taskDescription}\n\n${response.content.trim()}\n`;
  }

  async run(taskDescription: string, runOpts: RunOptions = {}): Promise<string> {
    this.cancelled = false;
    this.lastOutcome = "completed";
    this.iterationCount = 0;
    this.lastMessages = [];
    this.health = createHealthState();
    this.lastNudgeIteration = -Infinity;
    this.partialSuccess = undefined;
    this.subagentLimitContext = undefined;

    const skills = this.selectSkills(taskDescription);
    const maxIterations = this.opts.maxIterations ?? 20;
    const showConsole = this.opts.consoleThoughts !== false;

    this.transition({ phase: "running", task: taskDescription, iteration: 0, maxIterations });

    if (skills.length === 0) {
      this.io.log("No matching skill found for this task. Proceeding with base ReAct loop only.");
    } else {
      this.io.log(`Loaded skills: ${skills.map((s) => s.header.name).join(", ")}`);
    }

    // ── Build the initial graph state ──
    const initialState: GraphState = {
      messages: [
        { role: "system", content: this.buildSystemPrompt(skills) },
        { role: "user", content: taskDescription },
      ],
      iteration: 0,
      maxIterations,
      finalAnswer: "",
      done: false,
      validatorRejections: 0,
      cancelled: false,
    };

    // ── Build the graph (lazily, once) ──
    if (!this.app) {
      this.app = this.buildGraph();
    }

    // ── Run the graph ──
    let finalAnswer = "";
    try {
      const finalState = await this.app.invoke(initialState, {
        configurable: {
          taskDescription,
          showConsole,
          maxIterations,
          validationEnabled: this.opts.validateGoal !== false,
          maxValidatorRetries: this.opts.maxValidatorRet