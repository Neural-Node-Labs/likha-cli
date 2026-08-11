# Engine Selection Guide

This document explains how the xcoder orchestration engine is selected, how to switch between engines, and what each engine is designed for.

---

## Table of Contents

1. [Default Engine](#default-engine)
2. [How the Default Is Determined](#how-the-default-is-determined)
3. [Registered Engines](#registered-engines)
4. [How to Switch Engines](#how-to-switch-engines)
5. [Engine Comparison](#engine-comparison)
6. [Registering a Custom Engine](#registering-a-custom-engine)

---

## Default Engine

The default orchestration engine is **`"react"`** — the `ReActOrchestrator` class defined in `src/core/orchestrator.ts`.

```ts
// src/core/engine/EngineRegistry.ts
export const DEFAULT_ENGINE = "react";
```

This is the reference implementation: a full-featured ReAct loop with plan mode, phase planning, subagent delegation, and all standard tool support. It is the engine used by the CLI and API unless another engine is explicitly requested.

---

## How the Default Is Determined

The default engine is determined **entirely by the constant `DEFAULT_ENGINE`** in `src/core/engine/EngineRegistry.ts`. There is no environment variable, config file, or runtime heuristic that overrides this constant — the default is hard-coded at the module level.

### Where the default is consumed

| Entry point | How the default is used |
|---|---|
| **CLI** (`src/cli/index.ts`) | The `--engine` CLI option defaults to `DEFAULT_ENGINE`. If omitted, the CLI uses the `"react"` engine. |
| **API** (`src/api/routes.ts`) | All `/chat`, `/chat/plan`, and `/chat/execute` endpoints call `createEngine(DEFAULT_ENGINE, ...)`. The API always uses the default engine. |
| **Deploy mode** (`src/cli/index.ts`) | When `--deploy --llm true` is used, the engine is created via `createEngine(opts.engine, ...)` which falls back to `DEFAULT_ENGINE` if `--engine` is not specified. |

### Can it be configured via environment variable?

**No.** There is currently no `ENGINE` or `XCODER_ENGINE` environment variable that controls the default. The only way to select a non-default engine is:

1. **CLI**: Pass `--engine <name>` on the command line.
2. **Code**: Call `createEngine("swarm", deps)` or `createEngine("langgraph", deps)` directly in TypeScript.

If you need environment-variable-based selection, you can add it by modifying `EngineRegistry.ts` to read `process.env.XCODER_ENGINE` and use it as the default, or by modifying the CLI to check an environment variable before falling back to `DEFAULT_ENGINE`.

---

## Registered Engines

Four engines are registered in `src/core/engine/EngineRegistry.ts`:

| Name | Class | File | Description |
|---|---|---|---|
| `"react"` | `ReActOrchestrator` | `src/core/orchestrator.ts` | **Default.** Full ReAct loop with plan mode, phase planning, subagent delegation, goal validation, and health scoring. The most feature-complete engine. |
| `"lean"` | `LeanEngine` | `src/core/engine/LeanEngine.ts` | A focused, self-contained ReAct loop. Supports cancellation, progress observers, lifecycle state tracking, and self-healing health scoring. Does **not** include plan mode, phase planning, or subagent delegation. |
| `"swarm"` | `SwarmEngine` | `src/core/engine/SwarmEngine.ts` | An orchestrating ReAct engine that distributes tasks to parallel swarm agents. Creates a WBS (Work Breakdown Structure) plan, then assigns each task to a `LeanEngine` sub-agent. Tasks with no dependencies run in parallel. Includes goal validation and health scoring. |
| `"langgraph"` | `LangGraphEngine` | `src/core/engine/LangGraphEngine.ts` | A ReAct loop built on `@langchain/langgraph`'s `StateGraph`. Models the agent↔tools cycle as an explicit two-node graph with a conditional edge. Supports cancellation, progress observers, lifecycle state tracking, and self-healing health scoring. |

### Listing registered engines

You can list all registered engines at runtime:

```ts
import { listEngines } from "./core/engine/EngineRegistry.js";
console.log(listEngines()); // ["react", "lean", "swarm", "langgraph"]
```

Or from the CLI:

```bash
xcoder --help
# Look for the --engine option which lists registered engines
```

---

## How to Switch Engines

### Via CLI (`--engine` flag)

```bash
# Use the default "react" engine
xcoder "Refactor the auth module"

# Use the SwarmEngine for parallel task execution
xcoder --engine swarm "Build a full-stack application"

# Use the LangGraphEngine for graph-based ReAct
xcoder --engine langgraph "Debug the CI pipeline"

# Use the LeanEngine for a minimal loop
xcoder --engine lean "Fix the typo in README.md"
```

The `--engine` flag is also available with `--deploy` when using LLM-driven deployment:

```bash
xcoder --deploy --docker --llm true --engine swarm
```

### Via API (programmatic)

```ts
import { createEngine } from "./core/engine/EngineRegistry.js";

// Use the SwarmEngine
const engine = createEngine("swarm", { llm, telemetry, io, options });

// Use the LangGraphEngine
const engine = createEngine("langgraph", { llm, telemetry, io, options });

// Use the LeanEngine
const engine = createEngine("lean", { llm, telemetry, io, options });
```

### Via the API server

The API server (`src/api/routes.ts`) currently hard-codes `DEFAULT_ENGINE` for all endpoints. To use a different engine via the API, you would need to modify `routes.ts` to accept an `engine` parameter in the request body, for example:

```ts
// Proposed change (not yet implemented):
const engineName = req.body.engine ?? DEFAULT_ENGINE;
const orchestrator = createEngine(engineName, { llm, telemetry, options });
```

---

## Engine Comparison

| Feature | `react` (default) | `lean` | `swarm` | `langgraph` |
|---|---|---|---|---|
| **ReAct loop** | Full | Minimal | Orchestrator + sub-agents | Graph-based |
| **Plan mode** | ✅ | ❌ | ✅ (WBS) | ❌ |
| **Phase planning** | ✅ | ❌ | ❌ | ❌ |
| **Subagent delegation** | ✅ | ❌ | ✅ (parallel swarm) | ❌ |
| **Parallel execution** | ❌ | ❌ | ✅ | ❌ |
| **Cancellation** | ❌ | ✅ | ✅ | ✅ |
| **Progress observers** | ❌ | ✅ | ✅ | ✅ |
| **Lifecycle state** | ❌ | ✅ | ✅ | ✅ |
| **Health scoring** | ✅ | ✅ | ✅ | ✅ |
| **Self-healing nudges** | ✅ | ✅ | ✅ | ✅ |
| **Goal validation** | ✅ | ✅ | ✅ | ✅ |
| **Graph structure** | Procedural | Procedural | Procedural | `StateGraph` |
| **Dependencies** | None | None | None | `@langchain/langgraph` |
| **Best for** | General use | Simple, focused tasks | Large tasks with parallel subtasks | Experimentation with graph-based agents |

### When to use each engine

- **`react` (default)**: Use for most tasks. It has the richest feature set: plan mode, phase planning, subagent delegation, and all standard tool support. This is the recommended engine for day-to-day use.

- **`lean`**: Use when you want a minimal, predictable ReAct loop without plan mode or phase planning overhead. Good for simple, well-scoped tasks where you want the engine to "just go" without any planning ceremony.

- **`swarm`**: Use for large, complex tasks that can be decomposed into independent parallel subtasks. The SwarmEngine creates a WBS plan, then dispatches each task to a parallel `LeanEngine` sub-agent. Tasks with no dependencies run concurrently. Best for multi-file refactors, full-stack feature development, or any task where parallel execution can save time.

- **`langgraph`**: Use when you want to experiment with or leverage `@langchain/langgraph`'s explicit graph structure. The agent↔tools cycle is modeled as a `StateGraph` with named nodes and conditional edges, making the control flow explicit and inspectable. Useful for research, debugging ReAct behavior, or as a foundation for custom graph-based agent architectures.

---

## Registering a Custom Engine

To add a new engine, implement the `IReactEngine` (and optionally `IReactEngineV2`) interface, then register it in `EngineRegistry.ts`:

```ts
// 1. Create your engine class
import { IReactEngine, IReactEngineV2 } from "./IReactEngine.js";

class MyCustomEngine implements IReactEngine, IReactEngineV2 {
  // ... implement all required methods
}

// 2. Register it in EngineRegistry.ts
import { MyCustomEngine } from "./MyCustomEngine.js";

registerEngine("my-engine", ({ llm, telemetry, io, options }) => {
  return new MyCustomEngine(llm, telemetry, {
    maxIterations: options?.maxIterations,
    cwd: options?.cwd,
    io,
  });
});
```

Once registered, your engine is available via:

```bash
xcoder --engine my-engine "Your task here"
```

```ts
const engine = createEngine("my-engine", { llm, telemetry, io, options });
```

### Engine registration pattern

Each engine registration in `EngineRegistry.ts` follows the same pattern:

1. Define an options interface (e.g., `SwarmEngineOptions`, `LangGraphEngineOptions`).
2. Map `OrchestratorOptions` (the common options from the CLI/API) to the engine-specific options.
3. Call `registerEngine(name, factory)` at module load time.

See `src/core/engine/EngineRegistry.ts` for the canonical examples.

---

## Architecture Diagram

```
                    ┌──────────────────────┐
                    │   CLI / API Caller   │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   EngineRegistry     │
                    │   createEngine()     │
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
   ┌─────────────┐    ┌──────────────┐    ┌──────────────┐
   │  "react"    │    │   "swarm"    │    │ "langgraph"  │
   │ (default)   │    │              │    │              │
   │ ReActOrch.  │    │ SwarmEngine  │    │ LangGraphEng.│
   └─────────────┘    └──────┬───────┘    └──────────────┘
                             │
                    ┌────────▼────────┐
                    │  LeanEngine     │
                    │  (sub-agents)   │
                    └─────────────────┘
```

All engines implement the `IReactEngine` interface and are instantiated through the same `createEngine()` factory function, making them drop-in compatible at the CLI and API level.
