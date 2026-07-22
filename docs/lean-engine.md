# LeanEngine — Lightweight ReAct Orchestration Engine

## Overview

`LeanEngine` is a focused, self-contained ReAct loop engine that implements both the
[`IReactEngine`](../src/core/engine/IReactEngine.ts) and
[`IReactEngineV2`](../src/core/engine/IReactEngine.ts) interfaces. It provides the core
ReAct (Reasoning + Acting) loop — Thought → Action → Observation — without the additional
complexity of plan mode, phase planning, or subagent delegation that the full
`ReActOrchestrator` includes.

**Location:** `src/core/engine/LeanEngine.ts`  
**Tests:** `src/core/engine/__tests__/LeanEngine.test.ts`  
**Registration:** `src/core/engine/EngineRegistry.ts` (registered as `"lean"`)

## When to Use LeanEngine

Use `LeanEngine` when you need:

- A **clean, testable** ReAct loop with no plan mode or phase planning overhead
- **Cancellation support** — stop a running task from another async context
- **Progress reporting** — observe lifecycle state transitions in real time
- **Lifecycle state tracking** — introspect the engine's current phase (idle, running,
  validating, cancelled, completed, error)
- **Self-healing health scoring** — automatic detection of stalled progress with
  nudge injection

Use `ReActOrchestrator` (the default `"react"` engine) when you need:

- Plan mode (task decomposition before execution)
- Phase planning (multi-phase execution with isolated memory per phase)
- Subagent delegation (`subagent_tool`)
- Full workspace info snapshot injection
- Database persistence (task history, phase reports, WBS)

## Architecture

```
LeanEngine
  ├── Implements IReactEngine (run, generatePlan, selectSkills, ...)
  ├── Implements IReactEngineV2 (cancel, onProgress, getState, ...)
  ├── Uses SkillRegistry for skill routing
  ├── Uses toolDispatcher for tool execution
  ├── Uses goalValidator for completion validation
  ├── Uses stepScorer for health scoring
  └── Uses AgentIO for console reporting
```

### Lifecycle States

```
idle → running → validating → completed
                → cancelled
                → error
```

The engine transitions through these states during execution. Observers registered via
`onProgress()` are notified on every transition.

## Configuration

### LeanEngineOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxIterations` | `number` | `20` | Maximum ReAct loop iterations before stopping |
| `cwd` | `string` | `process.cwd()` | Working directory for tool execution |
| `tools` | `ToolSchema[]` | `TOOL_SCHEMAS` | Tool schemas passed to the LLM |
| `systemPrompt` | `string` | Built-in default | Custom system prompt override |
| `validateGoal` | `boolean` | `true` | Enable independent goal validation |
| `maxValidatorRetries` | `number` | `2` | Max validation rejection retries |
| `selfHealing` | `boolean` | `true` | Enable health-score-based self-healing nudges |
| `consoleThoughts` | `boolean` | `true` | Print thoughts/actions/observations to console |
| `io` | `AgentIO` | `new AutoIO()` | I/O abstraction for reporting |

## API

### Core Methods (IReactEngine)

#### `run(taskDescription: string, runOpts?: RunOptions): Promise<string>`

Executes a task to completion (or until stopped/limited) and returns the final answer text.

```typescript
const result = await engine.run("Refactor the login module");
```

#### `generatePlan(taskDescription: string): Promise<string>`

Generates a plan for the task without executing it. Returns markdown.

```typescript
const plan = await engine.generatePlan("Deploy to production");
```

#### `selectSkills(taskDescription: string): LoadedSkill[]`

Returns which skills would be routed for this task, without running anything.

```typescript
const skills = engine.selectSkills("Write a Dockerfile");
```

#### `getLastOutcome(): RunOutcome`

Returns how the most recent `run()` call ended.

Possible values: `"completed"`, `"iteration_limit"`, `"plan_rejected"`, `"partial_success"`, `"partial_completion"`

#### `getCumulativeUsage(): LlmUsage`

Returns cumulative token usage across all LLM calls.

#### `getHealthScore(window?: number): number`

Returns the rolling self-healing health score (0-100).

#### `getPartialSuccess(): PartialSuccessContext | undefined`

Returns partial-success context when the iteration limit was hit.

#### `getSubagentLimitContext(): SubagentLimitContext | undefined`

Returns subagent limit context when a subagent hit the iteration limit.

### V2 Methods (IReactEngineV2)

#### `cancel(reason?: string): void`

Cancels a running task. Idempotent — safe to call multiple times.

```typescript
engine.cancel("User requested stop");
```

#### `onProgress(observer: ProgressObserver): () => void`

Registers a progress observer. Returns an unsubscribe function.

```typescript
const unsubscribe = engine.onProgress((state) => {
  console.log(`Engine state: ${state.phase}`);
});
// Later:
unsubscribe();
```

#### `getState(): EngineState`

Returns the current engine lifecycle state.

```typescript
const state = engine.getState();
if (state.phase === "running") {
  console.log(`Iteration ${state.iteration}/${state.maxIterations}`);
}
```

#### `getLastMessages(): LlmMessage[]`

Returns the last ReAct message history from the most recent `run()` call.

#### `getWorkspacePath(): string`

Returns the effective tool-execution root for this run.

#### `getIterationCount(): number`

Returns the total number of ReAct loop iterations across all restarts.

## Usage

### Via EngineRegistry

```typescript
import { createEngine, listEngines } from "./EngineRegistry.js";

// List available engines
console.log(listEngines()); // ["react", "lean"]

// Create a LeanEngine
const engine = createEngine("lean", {
  llm: myLlmClient,
  telemetry: myTelemetry,
  options: {
    maxIterations: 30,
    validateGoal: true,
    selfHealing: true,
  },
});

// Run a task
const result = await engine.run("Analyze the codebase for security issues");
```

### Direct Instantiation

```typescript
import { LeanEngine } from "./LeanEngine.js";

const engine = new LeanEngine(llmClient, telemetry, {
  maxIterations: 15,
  validateGoal: false,
  consoleThoughts: true,
});

const result = await engine.run("Fix the failing test");
```

### With Progress Observers

```typescript
const engine = new LeanEngine(llm, telemetry);

engine.onProgress((state) => {
  switch (state.phase) {
    case "running":
      console.log(`Progress: ${state.iteration}/${state.maxIterations}`);
      break;
    case "completed":
      console.log(`Done! Outcome: ${state.outcome}`);
      break;
    case "cancelled":
      console.log(`Cancelled: ${state.reason}`);
      break;
    case "error":
      console.error(`Error: ${state.error.message}`);
      break;
  }
});

const result = await engine.run("Update the README");
```

### Cancellation

```typescript
const runPromise = engine.run("Long-running task");

// Cancel from another context (e.g., timeout, user request)
setTimeout(() => engine.cancel("Timeout exceeded"), 5000);

const result = await runPromise;
// result === "(Task was cancelled before completion.)"
console.log(engine.getState().phase); // "cancelled"
console.log(engine.getLastOutcome()); // "partial_success"
```

## Engine Registry Integration

The `LeanEngine` is registered in `EngineRegistry.ts` under the name `"lean"`:

```typescript
registerEngine("lean", ({ llm, telemetry, io, options }) => {
  const leanOpts: LeanEngineOptions = {
    maxIterations: options?.maxIterations,
    cwd: options?.cwd,
    validateGoal: options?.validateGoal,
    maxValidatorRetries: options?.maxValidatorRetries,
    selfHealing: options?.selfHealing,
    consoleThoughts: options?.consoleThoughts,
    io,
  };
  return new LeanEngine(llm, telemetry, leanOpts);
});
```

The default engine is `"react"` (the full `ReActOrchestrator`). To switch to `"lean"`,
pass `engine: "lean"` when creating the engine:

```typescript
const engine = createEngine("lean", deps);
```

## Differences from ReActOrchestrator

| Feature | LeanEngine | ReActOrchestrator |
|---------|-----------|-------------------|
| Plan mode | ❌ | ✅ |
| Phase planning | ❌ | ✅ |
| Subagent delegation | ❌ | ✅ |
| Cancellation | ✅ | ❌ (not in interface) |
| Progress observers | ✅ | ❌ |
| Lifecycle state tracking | ✅ | ❌ |
| Workspace info snapshot | ❌ | ✅ |
| Database persistence | ❌ | ✅ |
| Self-healing health scoring | ✅ | ✅ |
| Goal validation | ✅ | ✅ |
| Context compaction | ❌ | ✅ |

## Testing

The LeanEngine has 34 unit tests covering:

- **Construction** — default and custom options
- **Lifecycle (IReactEngineV2)** — state transitions, cancellation, progress observers,
  message history, iteration count
- **IReactEngine interface** — outcome tracking, cumulative usage, health score,
  partial success, subagent limit context, skill selection, plan generation
- **Run behavior** — task execution, tool calls, iteration limits, goal validation,
  LLM error handling
- **Edge cases** — empty tasks, long tasks, empty LLM responses, reasoning-only
  responses, multiple tool calls
- **EngineRegistry integration** — creation via registry, listing alongside react engine

Run the tests:

```bash
npx vitest run src/core/engine/__tests__/LeanEngine.test.ts
```

## Error Handling

The engine categorizes errors into three types via the `EngineError` discriminated union:

- **`llm`** — LLM call failures (network errors, rate limits, etc.)
- **`tool`** — Tool execution failures (file not found, permission denied, etc.)
- **`internal`** — Internal engine errors (unexpected state, logic bugs, etc.)

Each error has a `retryable` flag indicating whether the operation can be retried.

When an LLM call fails, the engine throws the error immediately (it does not swallow it).
When a tool call fails, the error is recorded in the message history and the loop continues.

## Design Decisions

1. **No plan mode or phase planning** — These features add significant complexity and are
   better suited to the full `ReActOrchestrator`. The LeanEngine focuses on being a clean,
   testable core loop.

2. **Cancellation via flag** — Uses a simple `cancelled` boolean flag checked at the top
   of each loop iteration. This is intentionally not a preemptive cancellation mechanism —
   the engine will finish the current tool call before stopping.

3. **Progress observers** — Uses a `Set<ProgressObserver>` pattern rather than EventEmitter
   or callback-based approaches. Observer errors are caught and silently ignored to prevent
   a misbehaving observer from crashing the engine.

4. **Health scoring** — Reuses the same `stepScorer.ts` module as `ReActOrchestrator` for
   consistent health score calculation across engines.

5. **No workspace info snapshot** — Unlike `ReActOrchestrator`, the LeanEngine does not
   automatically inject a workspace snapshot into the system prompt. This keeps the engine
   simpler and avoids the dependency on `workspaceInfo.ts`.
