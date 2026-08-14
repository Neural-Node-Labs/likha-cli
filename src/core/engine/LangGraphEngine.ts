// ronin:version 2 | ronin:task task-b88b43 | ronin:updated 2026-08-13T05:53:58.266Z | ronin:subtask code-st-5a7e6a
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

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { LlmClient, LlmMessage, LlmUsage, TelemetryInterface, ToolSchema, ToolCall, LoadedSkill, Phase } from "../types.js";
import { TOOL_SCHEMAS } from "../../tools/toolSchemas.js";
import { dispatchToolCall } from "../../tools/toolDispatcher.js";
import { SkillRegistry } from "../skillRegistry.js";
import { buildProtocolPrompt } from "../protocol.js";
import { validateGoal, buildObservationTranscript } from "../goalValidator.js";
import { createHealthState, scoreStep, rollingHealth, HealthState } from "../stepScorer.js";
import { compactStaleFileReads } from "../contextCompaction.js";
import { checkForTruncatedToolCalls, truncationWarningFor } from "../truncationGuard.js";
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
const READ_ONLY_TOOLS = new Set(["glob_tool", "grep_tool", "read_tool", "list_directory_tool", "find_files_tool", "get_dependency_graph_tool", "search_code_tool", "search_ast_tool", "read_outline_tool", "read_file_range_tool", "read_multiple_files_tool", "read_full_file_tool", "git_diff_tool", "git_log_tool", "validate_file_tool"]);

/** Tools that make changes to the workspace or external systems. */
const ACTION_TOOLS = new Set(["write_edit_tool", "ssh_tool", "schedule_task_tool", "docker_deploy_ssh_tool"]);

/** Tools that run tests or other validation checks. */
const VALIDATION_TOOLS = new Set(["playwright_run_tool"]);

/** GitHub actions that are read-only (no push/commit). */
const GITHUB_READ_ACTIONS = new Set(["clone", "fetch", "pull", "status"]);

/** Regex matching commands that are considered validation rather than action. */
const VALIDATION_COMMANDS = /\b(test|lint|type-?check|tsc|jest|pytest|kubectl (apply|rollout)|docker build|docker compose|playwright)\b/i;

/** Cooldown iterations between self-healing nudges. */
const NUDGE_COOLDOWN = 3;

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

  /** Set to true to keep every historical read_tool observation in full (disables the default
   *  lean-token context compaction). See src/core/contextCompaction.ts. Default: false (compact). */
  fullContextToken?: boolean;
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

  /** finish_reason of the most recent LLM response ("length" = cut off by max_tokens). Used by
   *  toolsNode to withhold large-payload tool calls generated from a truncated completion. */
  lastFinishReason: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
});

type GraphState = typeof GraphStateAnnotation.State;

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

  // The compiled langgraph — built once and reused.
  // Typed from buildGraph()'s own inferred return type rather than
  // `CompiledStateGraph<typeof GraphStateAnnotation, ...>`, because
  // StateGraph#compile() resolves its generics to the plain state shape
  // (e.g. `{ messages: LlmMessage[]; iteration: number; ... }`), not to
  // the `AnnotationRoot<...>` wrapper type itself.
  private app: ReturnType<LangGraphEngine["buildGraph"]> | null = null;

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

    // ── Build the graph if not yet built ──
    if (!this.app) {
      this.app = this.buildGraph();
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
      lastFinishReason: undefined,
    };

    // ── Run the graph ──
    let finalContent = "";
    try {
      const finalState = await this.app.invoke(initialState);
      this.lastMessages = finalState.messages || [];
      finalContent = finalState.finalAnswer || "";

      if (finalState.cancelled) {
        this.lastOutcome = "partial_success";
        this.transition({ phase: "cancelled", task: taskDescription, reason: "Cancelled during execution" });
      } else if (finalState.done) {
        this.lastOutcome = "completed";
        this.transition({ phase: "completed", task: taskDescription, outcome: "completed" });
      } else {
        this.lastOutcome = "partial_success";
        this.transition({ phase: "completed", task: taskDescription, outcome: "partial_success" });
      }
    } catch (err) {
      await this.telemetry.logError(err, `LangGraphEngine graph execution failed`);
      this.transition({
        phase: "error",
        task: taskDescription,
        error: { type: "llm", message: err instanceof Error ? err.message : String(err), retryable: true },
      });
      throw err;
    }

    if (showConsole) {
      this.io.totalUsage(this.cumulativeUsage, this.llmCallCount);
      if (this.health.scores.length > 0) {
        this.io.log(`📈 Final health score: ${this.getHealthScore()}/100 (${this.health.scores.length} scored steps)`);
      }
    }

    return finalContent;
  }

  // ─── Graph Building ──────────────────────────────────────────────────────────────

  /**
   * Builds the LangGraph StateGraph with agent and tools nodes.
   * The graph is built once and reused across run() calls.
   *
   * Graph structure:
   *   START -> agent -> tools -> agent -> tools -> ... -> END
   *              |                    ^
   *              +-- (conditional) ---+
   */
  private buildGraph() {
    const graph = new StateGraph(GraphStateAnnotation)
      .addNode("agent", async (state: GraphState) => {
        return await this.agentNode(state);
      })
      .addNode("tools", async (state: GraphState) => {
        return await this.toolsNode(state);
      })
      .addEdge(START, "agent")
      .addConditionalEdges("agent", (state: GraphState) => {
        return this.shouldContinue(state);
      })
      .addEdge("tools", "agent");

    return graph.compile();
  }

  /**
   * Agent node: calls the LLM with the accumulated message history and tool schemas.
   * If the LLM returns tool calls, they are stored in the state for the tools node.
   * If no tool calls, the `done` flag is set to true and the content becomes the final answer.
   */
  private async agentNode(state: GraphState): Promise<Partial<GraphState>> {
    const iteration = (state.iteration || 0) + 1;
    const maxIterations = state.maxIterations || 20;
    const showConsole = this.opts.consoleThoughts !== false;

    // Check iteration limit
    if (iteration > maxIterations) {
      this.lastOutcome = "partial_success";
      this.extractPartialSuccessContext(state.messages, iteration, 0);
      const report = await this.synthesizeReport(
        this.getTaskFromState(),
        state.messages,
        state.finalAnswer || "",
        maxIterations,
        0
      );
      return {
        iteration,
        done: true,
        finalAnswer: report,
      };
    }

    // Check cancellation
    if (this.cancelled || state.cancelled) {
      this.lastOutcome = "partial_success";
      return {
        iteration,
        done: true,
        cancelled: true,
        finalAnswer: "(Task was cancelled before completion.)",
      };
    }

    this.iterationCount = iteration;
    this.transition({ phase: "running", task: this.getTaskFromState(), iteration, maxIterations });

    // ── LLM call ──
    if (showConsole) this.io.spinnerStart("Thinking...");
    let response;
    try {
      response = await this.llm.complete(state.messages, { tools: this.opts.tools ?? TOOL_SCHEMAS });
    } catch (err) {
      if (showConsole) this.io.spinnerStop();
      await this.telemetry.logError(err, `LLM call failed at iteration ${iteration}`);
      this.transition({
        phase: "error",
        task: this.getTaskFromState(),
        error: { type: "llm", message: err instanceof Error ? err.message : String(err), retryable: true },
      });
      throw err;
    }
    if (showConsole) this.io.spinnerStop();
    this.addUsage(response.usage);

    // Show reasoning
    if (showConsole) {
      if (response.toolCalls && response.toolCalls.length > 0) {
        this.io.thought(response.reasoningContent ?? response.content);
      } else if (response.reasoningContent) {
        this.io.thought(response.reasoningContent);
      }
      this.io.usage(response.usage, this.cumulativeUsage.totalTokens);
    }

    // Build the assistant message
    const assistantMsg: LlmMessage = {
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls,
      reasoning_content: response.reasoningContent,
    };

    const newMessages = [...state.messages, assistantMsg];

    // ── No tool calls → candidate completion ──
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const validationEnabled = this.opts.validateGoal !== false;
      const maxValidatorRetries = this.opts.maxValidatorRetries ?? 2;
      let validatorRejections = state.validatorRejections || 0;

      if (validationEnabled && validatorRejections < maxValidatorRetries) {
        const transcript = buildObservationTranscript(newMessages);
        if (showConsole) this.io.spinnerStart("Validating completion...");
        this.transition({
          phase: "validating",
          task: this.getTaskFromState(),
          attempt: validatorRejections + 1,
          maxAttempts: maxValidatorRetries,
        });

        const verdict = await validateGoal(this.llm, this.getTaskFromState(), transcript, response.content);
        if (showConsole) this.io.spinnerStop();
        this.addUsage(verdict.usage);

        if (!verdict.valid) {
          validatorRejections += 1;
          this.io.log(`\n[goal validator] Rejected (attempt ${validatorRejections}/${maxValidatorRetries}): ${verdict.reason}`);

          newMessages.push({
            role: "user",
            content: `VALIDATION FAILED: An independent reviewer found your claimed completion is not supported by the recorded observations. Reason: "${verdict.reason}". Address this — either take the actions needed to actually satisfy the task, or correct your claim to match what the observations actually show. Then report completion again.`,
          });

          return {
            messages: newMessages,
            iteration,
            validatorRejections,
            done: false,
          };
        }
      }

      if (validationEnabled && validatorRejections >= maxValidatorRetries) {
        this.io.log(`\n[goal validator] Retries exhausted (${validatorRejections}/${maxValidatorRetries}) — accepting final answer WITHOUT independent verification.`);
      }

      this.io.log(response.content);
      return {
        messages: newMessages,
        iteration,
        done: true,
        finalAnswer: response.content,
      };
    }

    // ── Has tool calls — route to tools node ──
    return {
      messages: newMessages,
      iteration,
      done: false,
      lastFinishReason: response.finishReason,
    };
  }

  /**
   * Tools node: dispatches each tool call returned by the LLM and appends results
   * back into the message history.
   */
  private async toolsNode(state: GraphState): Promise<Partial<GraphState>> {
    const lastMsg = state.messages[state.messages.length - 1];
    if (!lastMsg || !lastMsg.tool_calls || lastMsg.tool_calls.length === 0) {
      return { done: true };
    }

    const showConsole = this.opts.consoleThoughts !== false;
    const newMessages = [...state.messages];

    const { safeCalls, blockedCalls } = checkForTruncatedToolCalls({
      content: lastMsg.content ?? "",
      toolCalls: lastMsg.tool_calls,
      finishReason: state.lastFinishReason,
    });
    for (const blocked of blockedCalls) {
      newMessages.push({ role: "tool", tool_call_id: blocked.id, name: blocked.function.name, content: truncationWarningFor(blocked) });
      if (showConsole) this.io.observation(`[withheld — response truncated by token limit] ${blocked.function.name}`, true);
    }

    for (const call of safeCalls) {
      if (showConsole) {
        const parsed = safeParse(call.function.arguments);
        this.io.action(call.function.name, parsed);
      }

      const result = await dispatchToolCall(call, this.cwd);

      // Score the step for health tracking
      if (this.opts.selfHealing !== false) {
        const { score } = scoreStep(this.health, {
          tool: result.toolName,
          args: safeParse(call.function.arguments),
          observation: result.observation,
          isError: result.isError,
        });
        if (showConsole) {
          this.io.observation(result.observation, result.isError, undefined, score);
        }
      } else if (showConsole) {
        this.io.observation(result.observation, result.isError);
      }

      if (result.isError) {
        await this.telemetry.logError(result.observation, `tool:${result.toolName}`);
      }

      newMessages.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        name: result.toolName,
        content: JSON.stringify(result.observation),
      });

      // Context compaction (lean-token mode, default ON): collapse stale full-file read_tool
      // observations once a fresher read/write of the same path exists. See contextCompaction.ts.
      if (!this.opts.fullContextToken && (result.toolName === "read_tool" || result.toolName === "write_edit_tool")) {
        const args = safeParse(call.function.arguments) as { filePath?: string } | undefined;
        if (args?.filePath) {
          compactStaleFileReads(newMessages, args.filePath, result.toolCallId);
        }
      }
    }

    // ── Self-healing nudge ──
    if (this.opts.selfHealing !== false) {
      const avgHealth = rollingHealth(this.health);
      const cooldownPassed = (state.iteration || 0) - this.lastNudgeIteration >= NUDGE_COOLDOWN;
      if (avgHealth < 40 && cooldownPassed && this.health.scores.length >= 2) {
        this.lastNudgeIteration = state.iteration || 0;
        if (showConsole) this.io.healthWarning(avgHealth);
        newMessages.push({
          role: "user",
          content: `[self-check] Your last several steps haven't been making much progress (rolling health score: ${avgHealth}/100 — errors and/or repeated identical actions with no new information). Before continuing: re-read the current state of whatever you're working on rather than assuming, double-check your last assumption was actually correct, and consider a genuinely different approach instead of retrying something similar.`,
        });
      }
    }

    return { messages: newMessages };
  }

  /**
   * Conditional edge: determines whether to continue the loop or terminate.
   * Returns "tools" if the agent made tool calls, or END if the agent produced a final answer.
   */
  private shouldContinue(state: GraphState): string {
    if (state.done) return END;
    if (state.cancelled) return END;
    if ((state.iteration || 0) > (state.maxIterations || 20)) return END;

    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
      return "tools";
    }

    return END;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────────

  private transition(newState: EngineState): void {
    this.state = newState;
    for (const observer of this.observers) {
      try {
        observer(newState);
      } catch {
        // Observer errors must never crash the engine
      }
    }
  }

  private getTaskFromState(): string {
    if (typeof this.state === "object" && "task" in this.state) {
      return (this.state as { task: string }).task;
    }
    return "";
  }

  private addUsage(usage: LlmUsage | undefined): void {
    if (!usage) return;
    this.llmCallCount += 1;
    this.cumulativeUsage.promptTokens += usage.promptTokens;
    this.cumulativeUsage.completionTokens += usage.completionTokens;
    this.cumulativeUsage.totalTokens += usage.totalTokens;
    this.cumulativeUsage.reasoningTokens = (this.cumulativeUsage.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0);
    this.cumulativeUsage.cachedTokens = (this.cumulativeUsage.cachedTokens ?? 0) + (usage.cachedTokens ?? 0);
  }

  private buildSystemPrompt(skills: LoadedSkill[]): string {
    const protocol = buildProtocolPrompt(this.cwd);

const base = `You are xcoder, a ReAct CLI agent. You have tools for searching the workspace (glob_tool, grep_tool, read_tool, list_directory_tool, find_files_tool, search_code_tool, search_ast_tool, get_dependency_graph_tool), making changes (write_edit_tool, ssh_tool, github_tool, docker_deploy_ssh_tool, schedule_task_tool), validating your work (run_command_tool, playwright_run_tool), and delegating isolated sub-tasks (subagent_tool). Follow the ReAct pattern: search for context before editing, and always validate your changes before considering a task done. Stop calling tools once the task is verified complete, and summarize what you did.

A workspace snapshot (file tree, tech stack, git status, package manifest) was already refreshed and is included below as ### Workspace context — you don't need to call workspace_info_tool just to see it. Only call workspace_info_tool(refresh=true) if that snapshot goes stale mid-task (after installing a dependency, creating/deleting files, or switching branches).

You do NOT automatically have any memory of previous tasks in this workspace — each task starts fresh. If the user says something like 'continue', 'keep going', 'what was the last task', or otherwise references earlier work without restating what it was, call task_history_tool (action='recent') before doing anything else to find out what that refers to. Don't guess or assume.

### Health Score Awareness
Your execution is tracked with a rolling health score (0-100) that measures whether your actions are making progress toward the goal. At each ReAct iteration, evaluate your progress. If your rolling health score drops below 40 (indicating repeated errors, duplicate actions, or stalled progress), propose actions that would increase it — such as re-reading the current state of files instead of assuming, trying a different approach, or verifying assumptions with a fresh tool call. After each tool call, the system automatically scores whether the action moved you closer to completion. Stay aware of this signal and adjust your strategy when the score indicates you're stuck.

### Clarification Requests
You have the ability to ask the user for clarification when you genuinely cannot proceed without more information. Use the clarification_tool to ask a question. The tool accepts:
- question (required): The specific question you need answered. Be precise and actionable.
- context (required): Brief context explaining why you're asking and what you've already determined.
- options (optional): A list of predefined choices the user can pick from.

**When to use it:**
- **Ambiguous requirements:** "Build a login system" without specifying auth method (JWT? OAuth? Session?).
- **Missing technology choices:** "Implement caching" without specifying Redis, Memcached, or in-memory.
- **Unclear constraints:** "Make it fast" without performance targets or benchmarks.
- **Contradictory instructions:** "Use SQL but also be schema-less" — ask which takes priority.
- **Missing context:** "Fix the bug" without specifying which bug, where it occurs, or how to reproduce.

**When NOT to use it:**
- Do NOT ask for clarification as a default behavior — only when genuinely uncertain.
- Do NOT ask for clarification on trivial details you can infer from context.
- Do NOT ask for clarification when you have enough information to make a reasonable choice — make the choice and proceed.
- Do NOT ask multiple questions at once — ask one question at a time.

When you call clarification_tool, execution pauses and your question is presented to the user. Their answer is injected back into your context so you can continue.`;



    const skillBlocks = skills.length
      ? `\n\nThe following specialized skill directives are loaded for this task — follow their Process/Strategies/Instructions/Planning/Experience guidance:\n\n${skills
          .map((s) => `## Skill: ${s.header.name} (${s.header.role})\n${s.body}`)
          .join("\n\n")}`
      : "";

    return `${protocol}<task_context>\n${base}${skillBlocks}\n</task_context>`;
  }

  /**
   * Extracts partial-success context from the message history when the iteration limit is hit.
   * Captures the last N tool calls, their results, files modified, files read, commands run,
   * and the last assistant thought.
   */
  private extractPartialSuccessContext(
    messages: LlmMessage[],
    iterationCount: number,
    restartCount: number
  ): void {
    const toolCalls: { name: string; args: string; result: string }[] = [];
    const filesModified: string[] = [];
    const filesRead: string[] = [];
    const commandsRun: string[] = [];
    let lastThought = "";

    const MAX_TOOL_CALLS = 10;
    for (let i = messages.length - 1; i >= 0 && toolCalls.length < MAX_TOOL_CALLS; i--) {
      const msg = messages[i];

      if (msg.role === "assistant" && msg.content) {
        if (!lastThought) lastThought = msg.content;
      }

      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (toolCalls.length >= MAX_TOOL_CALLS) break;
          const name = tc.function.name;
          const args = tc.function.arguments;

          if (name === "write_edit_tool") {
            try {
              const parsed = JSON.parse(args);
              if (parsed.filePath) filesModified.push(parsed.filePath);
            } catch { /* ignore parse errors */ }
          }

          if (name === "read_tool") {
            try {
              const parsed = JSON.parse(args);
              if (parsed.filePath) filesRead.push(parsed.filePath);
            } catch { /* ignore parse errors */ }
          }

          if (name === "run_command_tool") {
            try {
              const parsed = JSON.parse(args);
              if (parsed.command) commandsRun.push(parsed.command.slice(0, 100));
            } catch { /* ignore parse errors */ }
          }

          let result = "";
          for (let j = i + 1; j < messages.length; j++) {
            if (messages[j].role === "tool" && messages[j].tool_call_id === tc.id) {
              const content = typeof messages[j].content === "string"
                ? messages[j].content
                : JSON.stringify(messages[j].content);
              result = content.slice(0, 200);
              break;
            }
          }

          toolCalls.push({ name, args: args.slice(0, 150), result });
        }
      }
    }

    toolCalls.reverse();

    this.partialSuccess = {
      toolCalls,
      filesModified: [...new Set(filesModified)],
      filesRead: [...new Set(filesRead)],
      commandsRun: [...new Set(commandsRun)],
      lastThought,
      iterationCount,
      restartCount,
    };
  }

  /**
   * Synthesizes a meaningful report from the message history when the engine terminates
   * without a proper final answer (e.g., iteration limit hit while still making tool calls).
   * First tries to call the LLM for a coherent summary; falls back to mechanical reconstruction.
   */
  private async synthesizeReport(
    taskDescription: string,
    messages: LlmMessage[],
    currentFinalContent: string,
    maxIterations: number,
    restartCount: number
  ): Promise<string> {
    if (currentFinalContent && currentFinalContent.length > 30) {
      const trimmed = currentFinalContent.trim();
      if (!trimmed.endsWith("...") && !trimmed.endsWith("thinking...") && !trimmed.endsWith("working...")) {
        return currentFinalContent;
      }
    }

    const toolActions: string[] = [];
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
            toolActions.push(`${tc.function.name} ${argSummary}`);
          } catch {
            toolActions.push(tc.function.name);
          }
        }
      }
      if (msg.role === "tool" && msg.content) {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        observations.push(content.slice(0, 200));
      }
    }

    try {
      const llmSummary = await this.callLlmForSummary(
        taskDescription,
        messages,
        maxIterations,
        restartCount
      );
      if (llmSummary && llmSummary.length > 10) {
        return llmSummary;
      }
    } catch {
      // LLM call failed — fall through to mechanical fallback
    }

    const parts: string[] = [];
    parts.push(`Task stopped: hit the ${maxIterations}-iteration limit${restartCount > 0 ? ` after ${restartCount} restart(s)` : ""} without reaching a final answer.`);

    if (toolActions.length > 0) {
      parts.push(`\n## What was done\n\nThe following ${toolActions.length} tool call(s) were made:\n${toolActions.map((a) => `- ${a}`).join("\n")}`);
    }

    if (lastThought) {
      parts.push(`\n## Last model thought\n\n${lastThought.slice(0, 500)}`);
    }

    if (observations.length > 0) {
      parts.push(`\n## Key observations\n\n${observations.slice(-3).map((o) => `- ${o}`).join("\n")}`);
    }

    parts.push(`\n## Next steps\n\nPartial progress may exist in the workspace. Check the workspace files directly to see what was accomplished before continuing.`);

    return parts.join("\n");
  }

  /**
   * Calls the LLM to generate a structured report of what was accomplished vs. left undone
   * during a ReAct loop that hit the iteration limit.
   */
  private async callLlmForSummary(
    taskDescription: string,
    messages: LlmMessage[],
    maxIterations: number,
    restartCount: number
  ): Promise<string> {
    const transcriptParts: string[] = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;
      if (msg.role === "user" && msg.content) {
        transcriptParts.push(`[User] ${msg.content}`);
      } else if (msg.role === "assistant" && msg.content) {
        transcriptParts.push(`[Assistant] ${msg.content}`);
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            transcriptParts.push(`  → Tool call: ${tc.function.name}(${tc.function.arguments})`);
          }
        }
      } else if (msg.role === "tool" && msg.content) {
        const obs = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        transcriptParts.push(`  [Observation] ${obs}`);
      }
    }
    const conversationTranscript = transcriptParts.join("\n");

    const summaryPrompt: LlmMessage[] = [
      {
        role: "system",
        content: "You are a summarization assistant. Given a task description and the full conversation transcript of a ReAct loop that hit its iteration limit, produce a structured report with exactly four sections:\n\n## What was accomplished\nList the concrete actions taken: files read, files changed, commands run, tests executed, tool calls made. Be specific about what was done — reference actual file paths, command outputs, and results.\n\n## What was left undone\nDescribe what the task still needs that wasn't completed. Be honest about gaps.\n\n## Key decisions made\nNote any important choices or trade-offs made during execution — e.g., which approach was chosen, what was prioritized, what was deferred.\n\n## Blockers encountered\nList any errors, unexpected results, or obstacles that prevented further progress. If none were encountered, state \"No blockers encountered.\"\n\nBe factual and concise. Use bullet points for each section. Do not include the iteration limit details — those are already known.",
      },
      {
        role: "user",
        content: `Task: ${taskDescription}\n\nIterations: ${maxIterations}${restartCount > 0 ? ` across ${restartCount + 1} restart(s)` : ""}\n\nFull conversation transcript:\n${conversationTranscript}`,
      },
    ];

    const response = await this.llm.complete(summaryPrompt);
    this.addUsage(response.usage);
    return response.content.trim();
  }
}

// ─── Standalone helper functions ──────────────────────────────────────────────────

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
