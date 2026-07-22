import { LlmUsage, LoadedSkill } from "../types.js";

/**
 * The contract any orchestration engine must implement. `ReActOrchestrator` (src/core/orchestrator.ts)
 * is the default/reference implementation, but nothing outside src/core/engine/ is allowed to
 * depend on that class directly — callers (CLI, API) go through this interface plus
 * EngineRegistry.createEngine(), so a different engine (a non-ReAct planner, a LangGraph-style
 * graph executor, a mocked engine for tests, etc.) can be dropped in without touching the CLI
 * or API call sites.
 */
export interface RunOptions {
  skipPlanMode?: boolean;
  isSubagent?: boolean;
}

export type RunOutcome = "completed" | "iteration_limit" | "plan_rejected" | "partial_success" | "partial_completion";

export interface PartialSuccessContext {
  toolCalls: { name: string; args: string; result: string }[];
  filesModified: string[];
  filesRead: string[];
  commandsRun: string[];
  lastThought: string;
  iterationCount: number;
  restartCount: number;
}

export interface SubagentLimitContext {
  lastThought: string;
  toolCalls: string[];
  observations: string[];
  iterationCount: number;
}

export interface IReactEngine {
  /** Execute a task to completion (or until stopped/limited) and return the final answer text. */
  run(taskDescription: string, runOpts?: RunOptions): Promise<string>;

  /** Generate (but do not execute) a plan for the task — used by "plan preview" API endpoints. */
  generatePlan(taskDescription: string): Promise<string>;

  /** Which skills would be routed to for this task, without running anything. */
  selectSkills(taskDescription: string): LoadedSkill[];

  getLastOutcome(): RunOutcome;
  getCumulativeUsage(): LlmUsage | undefined;
  getHealthScore(): number;
  getPartialSuccess(): PartialSuccessContext | undefined;
  getSubagentLimitContext(): SubagentLimitContext | undefined;
}
