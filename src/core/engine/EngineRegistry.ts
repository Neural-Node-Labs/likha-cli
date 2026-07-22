import { LlmClient, TelemetryInterface } from "../types.js";
import { AgentIO } from "../io/AgentIO.js";
import { IReactEngine } from "./IReactEngine.js";
import { ReActOrchestrator, OrchestratorOptions } from "../orchestrator.js";

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
