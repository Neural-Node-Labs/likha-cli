# SwarmEngine — Orchestration Engine for Parallel Task Execution

The `SwarmEngine` is a multi-agent orchestration engine that implements both `IReactEngine` and `IReactEngineV2`. It distributes complex tasks across parallel swarm agents using a Work Breakdown Structure (WBS) planning phase, then orchestrates execution with self-healing capabilities, circuit breakers, and health scoring.

**File**: `src/core/engine/SwarmEngine.ts`  
**Registration name**: `"swarm"` (via `EngineRegistry.ts`)  
**Interfaces**: `IReactEngine`, `IReactEngineV2`

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Validation Rules](#validation-rules)
3. [Self-Healing Features](#self-healing-features)
4. [API Reference](#api-reference)
5. [Usage Examples](#usage-examples)
6. [Test Coverage](#test-coverage)
7. [Configuration Reference](#configuration-reference)

---

## Architecture Overview

The SwarmEngine operates in two phases:

### Phase 1: Planning (WBS Generation)

The orchestrating agent creates a detailed Work Breakdown Structure (WBS) — a markdown table with columns: `ID | Description | Dependencies | Instructions`. Each WBS item is a self-contained unit of work that a swarm agent can execute independently.

```
| ID | Description          | Dependencies | Instructions          |
| T1 | Set up database      | None         | Create schema, seed   |
| T2 | Build API endpoints  | T1           | Implement REST routes |
| T3 | Write frontend       | T1           | Build React UI        |
| T4 | Integration tests    | T2, T3       | End-to-end testing    |
```

### Phase 2: Orchestration

The orchestrator assigns tasks to swarm agents, respecting dependency ordering. Tasks with no dependencies run in parallel (up to `maxParallelAgents`). The orchestrator monitors progress, handles failures, and synthesizes a final report.

### Fallback: Single-Agent Mode

If WBS parsing fails (empty plan, header-only, circular dependencies), the engine falls back to single-agent mode using a `LeanEngine` instance.

---

## Validation Rules

### Input Validation

The `run()` method enforces strict input validation:

| Condition | Behavior |
|---|---|
| Empty string `""` | Throws `Error("SwarmEngine.run() requires a non-empty taskDescription string.")` |
| Whitespace-only `"   "` | Throws same error |
| `null` | Throws same error |
| `undefined` | Throws same error |
| Non-string type | Throws same error |
| Valid string | Proceeds with execution |

### WBS Validation

After parsing the WBS plan, the engine validates dependencies:

| Condition | Behavior |
|---|---|
| No tasks parsed | Falls back to single-agent mode |
| Header-only table | Falls back to single-agent mode |
| Circular dependencies (T1→T2→T1) | Falls back to single-agent mode with warning |
| Self-referential dependency (T1→T1) | Detected as circular, falls back |
| Valid DAG of dependencies | Proceeds with parallel orchestration |

### State Transition Validation

The engine enforces a strict lifecycle state machine:

```
idle → running → completed
     → running → cancelled
     → running → error
```

- `cancel()` is idempotent: calling it on `idle`, `completed`, or `cancelled` states is a no-op.
- `run()` resets all state before starting a new execution.
- State transitions are broadcast to all registered progress observers.

### Error State Types

Errors are categorized into a discriminated union:

```typescript
type EngineError =
  | { type: "llm"; message: string; retryable: boolean }
  | { type: "tool"; message: string; toolName: string; retryable: boolean }
  | { type: "internal"; message: string; retryable: boolean };
```

---

## Self-Healing Features

### Health Scoring

Every tool call step is scored 0–100 using the `stepScorer` module:

| Condition | Score Impact |
|---|---|
| Baseline | 70 |
| No error | +10 (total: 80) |
| Error | −45 (total: 25) |
| Duplicate action (same tool + args + observation) | −35 (total: 35) |
| Successful `write_edit_tool` or `run_command_tool` | +10 bonus |

The rolling health score averages the last 5 scored steps.

### Self-Healing Nudge

When the rolling health score drops below **40** (with at least 2 scored steps and a cooldown of 3 iterations since the last nudge), the engine injects a self-check message into the conversation:

```
[self-check] The orchestrator's recent actions haven't been making much progress
(rolling health score: ${avgHealth}/100 — errors and/or repeated identical actions
with no new information). Before continuing: re-read the current state of the WBS
tasks rather than assuming, double-check your last assumption was actually correct,
and consider a genuinely different approach instead of retrying something similar.
```

**Configuration**: `selfHealing` option (default: `true`). Set to `false` to disable.

### Circuit Breaker

Each WBS task tracks consecutive failures via `consecutiveFailures`. The circuit breaker threshold is **3** consecutive failures (`CIRCUIT_BREAKER_THRESHOLD`). When a task exceeds this threshold, the engine can skip it and continue with remaining tasks rather than retrying indefinitely.

### Error Recovery

- **LLM errors**: Caught and logged via telemetry. The engine transitions to `error` state with `retryable: true` and returns a descriptive error message.
- **Tool call errors**: Scored as errors in health tracking, but execution continues.
- **Observer errors**: Caught and silently ignored — a crashing observer never crashes the engine.

### Partial Success Tracking

When execution is cancelled or hits the iteration limit, the engine extracts a `PartialSuccessContext` containing:

```typescript
interface PartialSuccessContext {
  toolCalls: { name: string; args: string; result: string }[];
  filesModified: string[];
  filesRead: string[];
  commandsRun: string[];
  lastThought: string;
  iterationCount: number;
  restartCount: number;
}
```

### Report Synthesis

When the iteration limit is reached with uncompleted tasks, the engine synthesizes a final report via `synthesizeReport()`, which includes:
- What was accomplished (tool calls made)
- What remains uncompleted
- The last model thought
- Key observations

---

## API Reference

### Constructor

```typescript
constructor(llm: LlmClient, telemetry: TelemetryInterface, opts?: SwarmEngineOptions)
```

### SwarmEngineOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `maxIterations` | `number` | `30` | Max ReAct loop iterations for the orchestrator |
| `cwd` | `string` | `process.cwd()` | Working directory for tool execution |
| `tools` | `ToolSchema[]` | — | Custom tool schemas (defaults to `TOOL_SCHEMAS`) |
| `systemPrompt` | `string` | — | Custom system prompt override |
| `validateGoal` | `boolean` | `true` | Enable goal validation at each iteration |
| `maxValidatorRetries` | `number` | — | Max retries for goal validator |
| `selfHealing` | `boolean` | `true` | Enable health scoring and self-healing nudges |
| `consoleThoughts` | `boolean` | `true` | Log LLM thoughts to console |
| `io` | `AgentIO` | `new AutoIO()` | IO interface for reporting |
| `maxParallelAgents` | `number` | `5` | Max parallel swarm agents |
| `swarmAgentMaxIterations` | `number` | `15` | Max iterations per swarm agent |
| `persistArtifacts` | `boolean` | `true` | Persist WBS and phase reports to disk |
| `agentTimeoutMs` | `number` | `300000` | Timeout (ms) per swarm agent task (5 min) |

### IReactEngine Methods

#### `run(taskDescription: string, runOpts?: RunOptions): Promise<string>`

Executes a task to completion (or until stopped/limited). Returns the final answer text.

**Throws**: `Error` if `taskDescription` is empty, whitespace-only, null, or undefined.

**RunOptions**:
```typescript
interface RunOptions {
  skipPlanMode?: boolean;
  isSubagent?: boolean;
}
```

#### `generatePlan(taskDescription: string): Promise<string>`

Generates a WBS plan for the task without executing it. Returns a markdown string prefixed with `# Swarm Plan: <task>`.

#### `selectSkills(taskDescription: string): LoadedSkill[]`

Returns the skills that would be routed to for this task, without running anything.

#### `getLastOutcome(): RunOutcome`

Returns the outcome of the last run. Possible values: `"completed"`, `"iteration_limit"`, `"plan_rejected"`, `"partial_success"`, `"partial_completion"`.

#### `getCumulativeUsage(): LlmUsage | undefined`

Returns a **copy** of the cumulative LLM usage data (prompt tokens, completion tokens, total tokens, reasoning tokens, cached tokens).

#### `getHealthScore(window?: number): number`

Returns the rolling health score (average of last N scored steps, default: 5). Returns 100 if no steps have been scored.

#### `getPartialSuccess(): PartialSuccessContext | undefined`

Returns partial success context if the last run was cancelled or hit the iteration limit.

#### `getSubagentLimitContext(): SubagentLimitContext | undefined`

Returns subagent limit context if applicable.

### IReactEngineV2 Methods

#### `cancel(reason?: string): void`

Cancels a running task. Idempotent — no-op if already idle, completed, or cancelled.

**Postcondition**: `getState().phase === "cancelled"`

#### `onProgress(observer: ProgressObserver): () => void`

Registers a progress observer. Multiple observers are supported. Returns an unsubscribe function.

```typescript
type ProgressObserver = (state: EngineState) => void;
```

#### `getState(): EngineState`

Returns the current engine lifecycle state:

```typescript
type EngineState =
  | { phase: "idle" }
  | { phase: "planning"; task: string }
  | { phase: "running"; task: string; iteration: number; maxIterations: number }
  | { phase: "validating"; task: string; attempt: number; maxAttempts: number }
  | { phase: "cancelled"; task: string; reason: string }
  | { phase: "completed"; task: string; outcome: RunOutcome }
  | { phase: "error"; task: string; error: EngineError };
```

#### `getLastMessages(): LlmMessage[]`

Returns the message history from the most recent `run()` call. Empty array if no run has been performed.

#### `getWorkspacePath(): string`

Returns the effective tool-execution root for this run.

#### `getIterationCount(): number`

Returns the total number of ReAct loop iterations across all restarts for this run.

### Internal Methods (Private)

These methods are not part of the public API but are documented for understanding the implementation:

| Method | Purpose |
|---|---|
| `generateWbs(task, skills)` | Calls LLM to generate a WBS plan |
| `parseWbsTasks(wbsPlan)` | Parses markdown table into `WbsTask[]` |
| `validateWbsDependencies()` | Detects circular/self-referential dependencies |
| `dispatchReadyTasks()` | Auto-dispatches tasks whose dependencies are met |
| `handleSwarmToolCall(toolCall)` | Routes swarm-specific tool calls |
| `runSingleAgent(task, skills, opts)` | Falls back to LeanEngine for single-agent mode |
| `runGoalValidator(task)` | Validates orchestrator decisions |
| `synthesizeReport(...)` | Generates final report on iteration limit |
| `extractPartialSuccessContext(...)` | Captures partial success data |
| `buildSwarmSystemPrompt(skills, task)` | Builds the system prompt for the orchestrator |
| `buildOrchestratorPrompt(task)` | Builds the user prompt for the orchestrator |
| `getSwarmTools()` | Returns swarm-specific tool schemas |
| `writeWbsToDisk(task)` | Persists WBS to disk |

---

## Usage Examples

### Basic Usage

```typescript
import { SwarmEngine } from "./src/core/engine/SwarmEngine.js";
import { createMockLlm, createMockTelemetry } from "./test-helpers.js";

const llm = createMockLlm();
const telemetry = createMockTelemetry();

const engine = new SwarmEngine(llm, telemetry, {
  maxIterations: 20,
  validateGoal: false,
  selfHealing: true,
  maxParallelAgents: 5,
});

const result = await engine.run("Build a REST API with Express");
console.log(result);
```

### With Progress Observers

```typescript
const engine = new SwarmEngine(llm, telemetry, {
  maxIterations: 30,
  validateGoal: true,
});

const unsubscribe = engine.onProgress((state) => {
  switch (state.phase) {
    case "running":
      console.log(`Iteration ${state.iteration}/${state.maxIterations}`);
      break;
    case "completed":
      console.log(`Completed with outcome: ${state.outcome}`);
      break;
    case "error":
      console.error(`Error: ${state.error.message}`);
      break;
    case "cancelled":
      console.log(`Cancelled: ${state.reason}`);
      break;
  }
});

try {
  const result = await engine.run("Deploy to Kubernetes");
  console.log(`Final result: ${result}`);
} finally {
  unsubscribe();
}
```

### Cancellation

```typescript
const engine = new SwarmEngine(llm, telemetry, { maxIterations: 50 });

// Start the task
const runPromise = engine.run("Long-running data migration");

// Cancel after 5 seconds
setTimeout(() => {
  engine.cancel("Timeout: task exceeded 5 seconds");
}, 5000);

const result = await runPromise;
console.log(result); // Contains partial results
console.log(engine.getLastOutcome()); // "partial_success"
console.log(engine.getState().phase); // "cancelled"
```

### Healing Scenario: Detecting and Recovering from Stalled Execution

```typescript
// Simulate an orchestrator that keeps making the same failing tool call
const failingToolResponse = makeResponse({
  content: "Let me try again...",
  toolCalls: [{
    id: "call_fail",
    type: "function",
    function: { name: "run_command_tool", arguments: '{"command":"invalid-command"}' },
  }],
});

const mockLlm = createRepeatingMockLlm(failingToolResponse);

const engine = new SwarmEngine(mockLlm, telemetry, {
  maxIterations: 20,
  selfHealing: true,  // Enable self-healing
  validateGoal: false,
  consoleThoughts: true,
});

// After ~3 iterations, the health score drops below 40
// The engine injects a self-healing nudge into the conversation
// After ~6 iterations (nudge cooldown of 3), another nudge may fire
const result = await engine.run("Fix the build script");

// Check health score
console.log(`Health score: ${engine.getHealthScore()}`); // Likely < 40
console.log(`Outcome: ${engine.getLastOutcome()}`); // "iteration_limit"
```

### Healing Scenario: Circuit Breaker for Failing Tasks

```typescript
// When a specific WBS task fails 3+ times consecutively,
// the circuit breaker trips and the task is skipped
const engine = new SwarmEngine(llm, telemetry, {
  maxIterations: 30,
  selfHealing: true,
  maxParallelAgents: 3,
});

// The engine tracks consecutiveFailures per WbsTask
// After 3 failures (CIRCUIT_BREAKER_THRESHOLD), the task is marked as "skipped"
// and the orchestrator continues with remaining tasks

const result = await engine.run("Complex multi-step deployment");
// Failed tasks are skipped, successful ones are reported
```

### Healing Scenario: Error Recovery from LLM Failure

```typescript
// Simulate an LLM that fails intermittently
let callCount = 0;
const flakyLlm: LlmClient = {
  complete: vi.fn(async () => {
    callCount++;
    if (callCount === 2) {
      throw new Error("LLM API rate limit exceeded");
    }
    return makeResponse({ content: "Task completed.", toolCalls: [] });
  }),
};

const engine = new SwarmEngine(flakyLlm, telemetry, {
  maxIterations: 5,
  selfHealing: true,
  validateGoal: false,
});

try {
  const result = await engine.run("Simple task");
  console.log(result);
} catch (err) {
  // The error is caught, logged via telemetry, and the engine
  // transitions to error state with retryable: true
  console.error(engine.getState());
  // { phase: "error", task: "Simple task", error: { type: "llm", message: "...", retryable: true } }
}
```

### Via EngineRegistry

```typescript
import { createEngine, listEngines } from "./src/core/engine/EngineRegistry.js";

// List available engines
console.log(listEngines()); // ["react", "lean", "swarm", "langgraph"]

// Create a SwarmEngine via the registry
const engine = createEngine("swarm", { llm, telemetry, options: {
  maxIterations: 15,
  selfHealing: true,
}});

const result = await engine.run("Analyze codebase for security issues");
```

### CLI Usage

```bash
# Use the swarm engine from the CLI
xcoder --engine swarm --task "Refactor the authentication module"

# With custom iteration limit
xcoder --engine swarm --task "Deploy microservices"

---

## Test Coverage

The SwarmEngine test suite is located at `src/core/engine/__tests__/SwarmEngine.test.ts` and covers the following areas:

### Test Categories

| Category | Tests | Description |
|---|---|---|
| **Construction & Defaults** | 4 tests | Verifies engine creation with default/custom options, workspace path resolution |
| **Input Validation** | 4 tests | Empty string, whitespace-only, null, undefined task descriptions |
| **Lifecycle (IReactEngineV2)** | 10 tests | State transitions, cancellation (including idempotency), progress observers (subscribe/unsubscribe, error isolation, multiple observers) |
| **IReactEngine Interface** | 8 tests | Outcome tracking, cumulative usage (including copy semantics), health score, partial success, subagent limit, skill selection, plan generation |
| **WBS Parsing & Validation** | 3+ tests | Empty WBS fallback, header-only fallback, circular dependency detection |

### Key Test Patterns

#### Mock LLM Client

```typescript
// Simple mock that returns a fixed response
function createMockLlm(responses?: LlmResponse[]): LlmClient {
  const defaultResponse = makeResponse({ content: "Task completed successfully." });
  let callIndex = 0;
  return {
    complete: vi.fn(async (_messages, _opts?) => {
      const resp = responses ? responses[callIndex++] ?? defaultResponse : defaultResponse;
      return resp;
    }),
  };
}

// Repeating mock for testing iteration limits
function createRepeatingMockLlm(response: LlmResponse): LlmClient {
  return {
    complete: vi.fn(async () => response),
  };
}
```

#### WBS Plan Fixtures

```typescript
const SINGLE_TASK_WBS =
  "| ID | Description | Dependencies | Instructions |\n" +
  "| T1 | Test task | None | Do something |";

const MULTI_TASK_WBS =
  "| ID | Description | Dependencies | Instructions |\n" +
  "| T1 | Task one | None | Do first thing |\n" +
  "| T2 | Task two | T1 | Do second thing |\n" +
  "| T3 | Task three | T1 | Do third thing |";

const CIRCULAR_DEP_WBS =
  "| ID | Description | Dependencies | Instructions |\n" +
  "| T1 | Task one | T2 | Depends on T2 |\n" +
  "| T2 | Task two | T1 | Depends on T1 |";

const SELF_DEP_WBS =
  "| ID | Description | Dependencies | Instructions |\n" +
  "| T1 | Task one | T1 | Self-referential |";
```

#### Testing Cancellation

```typescript
it("supports cancellation", async () => {
  const delayedLlm: LlmClient = {
    complete: vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        await new Promise((r) => setTimeout(r, 50));
        return toolCallResponse;
      }
      return completionResponse;
    }),
  };
  const engine = new SwarmEngine(delayedLlm, telemetry, {
    maxIterations: 10,
    validateGoal: false,
    persistArtifacts: false,
  });

  // Mock generateWbs to return a valid WBS plan
  (engine as any).generateWbs = vi.fn(async () => SINGLE_TASK_WBS);

  const runPromise = engine.run("test task");
  setTimeout(() => engine.cancel("test cancellation"), 10);

  const result = await runPromise;
  expect(result).toContain("cancelled");
  expect(engine.getLastOutcome()).toBe("partial_success");
  const state = engine.getState();
  expect(state.phase).toBe("cancelled");
});
```

#### Testing Observer Error Isolation

```typescript
it("observer errors do not crash the engine", async () => {
  const engine = new SwarmEngine(llm, telemetry, {
    maxIterations: 1,
    validateGoal: false,
    persistArtifacts: false,
  });
  engine.onProgress(() => {
    throw new Error("observer error");
  });

  const result = await engine.run("test task");
  expect(result).toBe("Task completed successfully.");
});
```

### Running the Tests

```bash
# Run all engine tests
npx vitest run src/core/engine/__tests__/

# Run only SwarmEngine tests
npx vitest run src/core/engine/__tests__/SwarmEngine.test.ts

# Watch mode
npx vitest --watch src/core/engine/__tests__/SwarmEngine.test.ts
```

---

## Configuration Reference

### Environment Variables

The SwarmEngine respects the following environment variables (shared with the rest of the xcoder system):

| Variable | Purpose | Default |
|---|---|---|
| `MAX_ITERATIONS` | ReAct loop iteration ceiling | `30` (SwarmEngine default) |
| `XCODER_API_KEY` | API authentication | — |

### SwarmEngineOptions (Full Reference)

```typescript
interface SwarmEngineOptions {
  /** Max ReAct loop iterations for the orchestrator. Default: 30 */
  maxIterations?: number;

  /** Working directory for tool execution. Default: process.cwd() */
  cwd?: string;

  /** Custom tool schemas. Defaults to TOOL_SCHEMAS from toolSchemas.ts */
  tools?: ToolSchema[];

  /** Custom system prompt override */
  systemPrompt?: string;

  /** Enable goal validation at each iteration. Default: true */
  validateGoal?: boolean;

  /** Max retries for goal validator */
  maxValidatorRetries?: number;

  /** Enable health scoring and self-healing nudges. Default: true */
  selfHealing?: boolean;

  /** Log LLM thoughts to console. Default: true */
  consoleThoughts?: boolean;

  /** IO interface for reporting. Default: new AutoIO() */
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
```

### WbsTask Interface

```typescript
interface WbsTask {
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
```

### Constants

| Constant | Value | Description |
|---|---|---|
| `DEFAULT_AGENT_TIMEOUT_MS` | `300_000` (5 min) | Default timeout per swarm agent task |
| `CIRCUIT_BREAKER_THRESHOLD` | `3` | Max consecutive failures before circuit breaker trips |
| `NUDGE_COOLDOWN` | `3` | Iterations between self-healing nudges |

### Engine Registration

The SwarmEngine is registered in `EngineRegistry.ts` with default `maxParallelAgents: 5`:

```typescript
registerEngine("swarm", ({ llm, telemetry, io, options }) => {
  const swarmOpts: SwarmEngineOptions = {
    maxIterations: options?.maxIterations,
    cwd: options?.cwd,
    validateGoal: options?.validateGoal,
    maxValidatorRetries: options?.maxValidatorRetries,
    selfHealing: options?.selfHealing,
    consoleThoughts: options?.consoleThoughts,
    io,
    maxParallelAgents: 5,
  };
  return new SwarmEngine(llm, telemetry, swarmOpts);
});
```

---

## Changelog

| Date | Change | Author |
|---|---|---|
| 2026-07-22 | Initial documentation — validation rules, healing features, API reference, usage examples, test coverage | Phase 4 |