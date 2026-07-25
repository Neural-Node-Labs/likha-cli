import { LlmClient, TelemetryInterface } from "../types.js";
import { AgentIO } from "../io/AgentIO.js";
import { IReactEngine } from "./IReactEngine.js";
import { ReActOrchestrator, OrchestratorOptions } from "../orchestrator.js";
import { LeanEngine, LeanEngineOptions } from "./LeanEngine.js";
import { LangGraphEngine, LangGraphEngineOptions } from "./LangGraphEngine.js";
import { SwarmEngine, SwarmEngineOptions } from "./SwarmEngine.js";

export interface EngineDeps {
  llm: LlmClient;
  telemetry: TelemetryInterface;
  io?: AgentIO;
  options?: OrchestratorOptions;
}

export type EngineFactory = (deps: EngineDeps) => IReactEngine;

const registry = new Map<string, EngineFactory>();

/** Register an engine implementation under a name. Call once at module load. */
export function registerEngine(name: string, factory: EngineFactory): void {
  registry.set(name, factory);
}

/** Instantiate a registered engine by name. Throws on an unknown name (with the known list). */
export function createEngine(name: string, deps: EngineDeps): IReactEngine {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(`Unknown engine "${name}". Registered engines: ${listEngines().join(", ") || "(none)"}`);
  }
  return factory(deps);
}

export function listEngines(): string[] {
  return Array.from(registry.keys());
}

export const DEFAULT_ENGINE = "react";

// The reference engine: the existing ReAct loop, unchanged in behavior, just built against
// AgentIO instead of talking to stdio directly. Registered here (not inside orchestrator.ts)
// so the file that owns "which engines exist" stays independent of any one engine's module.
registerEngine(DEFAULT_ENGINE, ({ llm, telemetry, io, options }) => new ReActOrchestrator(llm, telemetry, { ...options, io }));

// The LeanEngine: a focused, self-contained ReAct loop that implements both IReactEngine and
// IReactEngineV2. Supports cancellation, progress observers, lifecycle state tracking, and
// self-healing health scoring. Does NOT include plan mode, phase planning, or subagent delegation
// — those live in the full ReActOrchestrator. This is the core loop, clean and testable.
registerEngine("lean", ({ llm, telemetry, io, options }) => {
  const leanOpts: LeanEngineOptions = {
    maxIterations: options?.maxIterations,
    cwd: options?.cwd,
    validateGoal: options?.validateGoal,
    maxValidatorRetries: options?.maxValidatorRetries,
    selfHealing: options?.selfHealing,
    consoleThoughts: options?.consoleThoughts,
    fullContextToken: options?.fullContextToken,
    io,
  };
  return new LeanEngine(llm, telemetry, leanOpts);
});

// The SwarmEngine: an orchestrating ReAct engine that distributes tasks to swarm agents
// running in parallel. The Orchestrating Agent creates a detailed WBS plan, then assigns
// each task to a Swarm Agent with complete instructions. Swarm Agents report back status
// and results. Tasks with no dependencies run in parallel. A Goal Validator checks the
// Orchestrator at each ReAct loop iteration and grades its decisions.
registerEngine("swarm", ({ llm, telemetry, io, options }) => {
  const swarmOpts: SwarmEngineOptions = {
    maxIterations: options?.maxIterations,
    cwd: options?.cwd,
    validateGoal: options?.validateGoal,
    maxValidatorRetries: options?.maxValidatorRetries,
    selfHealing: options?.selfHealing,
    consoleThoughts: options?.consoleThoughts,
    fullContextToken: options?.fullContextToken,
    io,
    maxParallelAgents: 5,
  };
  return new SwarmEngine(llm, telemetry, swarmOpts);
});

// The LangGraphEngine: a LangGraph StateGraph-based ReAct loop that implements both
// IReactEngine and IReactEngineV2. Uses LangGraph's explicit two-node "agent" <-> "tools"
// graph with a conditional edge — the classic LangGraph ReAct tutorial pattern — rather
// than a hand-rolled loop. Same tool set (toolSchemas.ts / toolDispatcher.ts) and same
// LlmClient as the other engines. Supports cancellation, progress observers, lifecycle
// state tracking, and self-healing health scoring.
registerEngine("langgraph", ({ llm, telemetry, io, options }) => {
  const lgOpts: LangGraphEngineOptions = {
    maxIterations: options?.maxIterations,
    cwd: options?.cwd,
    validateGoal: options?.validateGoal,
    maxValidatorRetries: options?.maxValidatorRetries,
    selfHealing: options?.selfHealing,
    consoleThoughts: options?.consoleThoughts,
    fullContextToken: options?.fullContextToken,
    io,
  };
  return new LangGraphEngine(llm, telemetry, lgOpts);
});
