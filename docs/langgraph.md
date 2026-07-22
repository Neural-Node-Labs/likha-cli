# LangGraphEngine — Documentation

> **File:** `src/core/engine/LangGraphEngine.ts`  
> **Registered name:** `"langgraph"` (via `EngineRegistry.ts`)  
> **Interfaces:** `IReactEngine` + `IReactEngineV2`  
> **Drop-in compatible with:** `LeanEngine`, `ReActOrchestrator`

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture: The LangGraph StateGraph Pattern](#architecture-the-langgraph-stategraph-pattern)
3. [Lifecycle & Engine States](#lifecycle--engine-states)
4. [Configuration Options](#configuration-options)
5. [Graph Nodes in Detail](#graph-nodes-in-detail)
   - [Agent Node](#agent-node)
   - [Tools Node](#tools-node)
   - [Conditional Edge](#conditional-edge)
6. [Key Features](#key-features)
   - [Goal Validation](#goal-validation)
   - [Self-Healing Health Scoring](#self-healing-health-scoring)
   - [Partial Success & Iteration Limits](#partial-success--iteration-limits)
   - [Cancellation & Progress Observers](#cancellation--progress-observers)
7. [Comparison with LeanEngine](#comparison-with-leanengine)
8. [Usage](#usage)
9. [Internal Helpers](#internal-helpers)
10. [Standalone Helper Functions](#standalone-helper-functions)

---

## Overview

`LangGraphEngine` is a ReAct loop engine modeled on [LangGraph](https://langchain-ai.github.io/langgraph/)'s `StateGraph` pattern. It implements the classic LangGraph ReAct tutorial architecture as an explicit **two-node state machine**:

```
START ──► agent ──► tools ──► agent ──► tools ──► ... ──► END
             │                        ▲
             └──── (conditional) ─────┘
```

- **agent node** — calls the LLM (`LlmClient.complete()`) with the accumulated message history and available tool schemas.
- **tools node** — dispatches each tool call returned by the LLM via `dispatchToolCall()` and appends the results back into the message history.
- **conditional edge** — if the LLM returns zero tool calls, the graph routes to END (completion); otherwise it routes back to the tools node, then back to the agent node.

### Design Philosophy

Unlike the hand-rolled `while(true)` loop in `LeanEngine` or the multi-phase `ReActOrchestrator`, this engine makes the graph structure explicit. The state (`GraphState`) flows through named nodes, and the routing logic is a single conditional check rather than being interleaved with loop control flow. This makes it easier to:

- Add new nodes (e.g., a "reflect" node between tools and agent)
- Add parallel tool execution branches
- Visualize and debug the execution flow
- Swap in a real LangGraph runtime later without restructuring the code

---

## Architecture: The LangGraph StateGraph Pattern

The engine does **not** depend on the LangChain/LangGraph npm packages. Instead, it implements the same `StateGraph` pattern as a lightweight in-memory state machine using the project's own types (`LlmMessage`, `ToolCall`, `LlmClient`, etc.).

### GraphState

The state that flows through the graph nodes:

```typescript
interface GraphState {
  /** Accumulated conversation history (system + user + assistant + tool messages). */
  messages: LlmMessage[];

  /** Current iteration number (1-based). */
  iteration: number;

  /** Maximum iterations before forced termination. */
  maxIterations: number;

  /** The final answer text, populated when `done` becomes true. */
  finalAnswer: string;

  /** Termination flag — set to true when the agent produces a final answer. */
  done: boolean;
}
```

### Execution Flow

```
┌─────────────────────────────────────────────────────────────┐
│                         START                               │
│  Build initial GraphState with system prompt + user task    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    AGENT NODE                                │
│  Call LLM with messages + tool schemas                      │
│  Returns: content + toolCalls (or empty)                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
              ┌──────────────────────────┐
              │  Conditional Edge        │
              │  toolCalls.length === 0? │
              └──────┬──────────┬────────┘
                     │          │
                   YES          NO
                     │          │
                     ▼          ▼
              ┌──────────┐  ┌──────────────────────────────────┐
              │   END    │  │         TOOLS NODE               │
              │  Return  │  │  For each tool call:             │
              │  answer  │  │  1. dispatchToolCall()           │
              └──────────┘  │  2. Append result to messages    │
                            │  3. Score step for health        │
                            │  4. Self-healing nudge check     │
                            └──────────────┬───────────────────┘
                                           │
                                           ▼
                              (loop back to AGENT NODE)
```

---

## Lifecycle & Engine States

The engine tracks its state through a discriminated union (`EngineState`):

| State | Description |
|-------|-------------|
| `idle` | Constructed, not yet running |
| `running` | Actively executing the ReAct loop |
| `validating` | Running the goal validator on a candidate completion |
| `cancelled` | Cancelled by caller via `cancel()` |
| `completed` | Finished normally or with partial success |
| `error` | Unrecoverable error (LLM failure, etc.) |

Progress observers registered via `onProgress()` receive every state transition.

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

---

## Configuration Options

```typescript
interface LangGraphEngineOptions {
  /** Maximum ReAct iterations before the engine stops (default: 20). */
  maxIterations?: number;

  /** Working directory for tool execution (default: process.cwd()). */
  cwd?: string;

  /** Tool schemas to expose to the LLM (default: TOOL_SCHEMAS from toolSchemas.ts). */
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

  /** Custom I/O adapter (default: AutoIO). */
  io?: AgentIO;
}
```

---

## Graph Nodes in Detail

### Agent Node

The agent node is the LLM call step. It:

1. Sends the accumulated `messages` array to `this.llm.complete()` with the available tool schemas.
2. Captures the response (content + tool calls + usage).
3. Accumulates token usage statistics.
4. Displays reasoning content to the console (if `consoleThoughts` is enabled).

```typescript
response = await this.llm.complete(state.messages, {
  tools: this.opts.tools ?? TOOL_SCHEMAS
});
```

### Tools Node

The tools node executes every tool call returned by the LLM. For each tool call:

1. **Classifies the phase** — determines whether the tool is a `"search"`, `"action"`, or `"validation"` step (see `classifyPhase()` helper).
2. **Creates a ReActStep** — records the iteration, phase, thought, and action for telemetry.
3. **Dispatches the tool** — calls `dispatchToolCall(call, cwd)` which routes to the appropriate tool implementation.
4. **Scores the step** — if self-healing is enabled, runs `scoreStep()` to evaluate whether the tool call was productive.
5. **Logs telemetry** — records the thought and any errors.
6. **Appends the result** — pushes a `role: "tool"` message back into the conversation history.

### Conditional Edge

After the agent node returns, the engine checks:

```typescript
if (response.toolCalls.length === 0) {
  // Route to END — candidate completion
  // (Optionally run goal validation before accepting)
  state.done = true;
  break;
} else {
  // Route to TOOLS node
  // Execute tool calls, then loop back to AGENT node
}
```

---

## Key Features

### Goal Validation

When the LLM produces a final answer (no tool calls), the engine optionally runs an independent goal validator (`validateGoal()`) that checks whether the claimed completion is supported by the recorded observations.

```
LLM produces final answer
        │
        ▼
  ┌─────────────────┐
  │ Goal Validator   │
  │ Checks if the    │
  │ answer is backed │
  │ by observations  │
  └────────┬────────┘
           │
     ┌─────┴─────┐
     │           │
   VALID       INVALID
     │           │
     │           ▼
     │    Inject rejection
     │    reason into
     │    conversation
     │    and loop back
     │    to agent node
     ▼
  Accept answer
```

- After `maxValidatorRetries` (default: 2) consecutive rejections, the answer is accepted **without** verification, and a warning is logged.
- The validator rejection message is injected as a `role: "user"` message so the LLM can correct itself.

### Self-Healing Health Scoring

When enabled (default), the engine monitors a rolling health score:

1. Each tool call is scored by `scoreStep()` based on whether it errored, produced new information, or repeated previous actions.
2. The rolling average is computed via `rollingHealth()`.
3. If the average drops below **40** and at least **3 iterations** have passed since the last nudge, a self-check message is injected into the conversation:

```
[self-check] Your last several steps haven't been making much progress
(rolling health score: X/100 — errors and/or repeated identical actions
with no new information). Before continuing: re-read the current state
of whatever you're working on rather than assuming, double-check your
last assumption was actually correct, and consider a genuinely different
approach instead of retrying something similar.
```

### Partial Success & Iteration Limits

If the iteration limit is reached without a final answer, the engine:

1. **Extracts partial-success context** — walks the message history in reverse (most recent first) and captures up to 10 tool calls, their results, files modified, files read, commands run, and the last assistant thought. Stored in `this.partialSuccess` for retrieval via `getPartialSuccess()`.

2. **Attempts an LLM summary** — calls `callLlmForSummary()` which sends the conversation transcript to the LLM with a structured summarization prompt requesting four sections:
   - What was accomplished
   - What was left undone
   - Key decisions made
   - Blockers encountered

3. **Falls back to mechanical reconstruction** — if the LLM summary call fails or returns a trivial result, the engine builds a report from the raw message history listing tool calls made, the last model thought, key observations, and suggested next steps.

### Cancellation & Progress Observers

- **`cancel(reason?)`** — idempotent; sets a cancellation flag that is checked at the top of each iteration. The engine transitions to `phase: "cancelled"` and stops.
- **`onProgress(observer)`** — registers a callback that receives every `EngineState` transition. Returns an unsubscribe function. Observer errors are caught and silently ignored to prevent observer crashes from propagating into the engine's execution.

---

## Comparison with LeanEngine

| Aspect | LeanEngine | LangGraphEngine |
|--------|-----------|-----------------|
| Loop structure | `while(true)` with inline routing | Explicit `GraphState` + conditional edge |
| State management | Local variables in `run()` | `GraphState` object passed through nodes |
| Extensibility | Add logic inside the loop | Add new nodes with named transitions |
| Mental model | Procedural ReAct loop | Graph-based agent cycle |
| Interfaces | `IReactEngine` + `IReactEngineV2` | `IReactEngine` + `IReactEngineV2` |
| Tool set | `toolSchemas.ts` / `toolDispatcher.ts` | Same (shared) |
| LLM client | `LlmClient` | Same (shared) |
| Goal validator | `validateGoal()` | Same (shared) |
| Health scoring | `stepScorer.ts` | Same (shared) |
| I/O | `AgentIO` / `AutoIO` | Same (shared) |

Both engines are **drop-in compatible** — they share the same tool set, LLM client, goal validator, health scorer, and I/O abstractions.

---

## Usage

### Basic

```typescript
import { LangGraphEngine } from "./src/core/engine/LangGraphEngine.js";

const engine = new LangGraphEngine(llmClient, telemetryService, {
  maxIterations: 30,
  validateGoal: true,
  selfHealing: true,
  consoleThoughts: true,
});

const answer = await engine.run("Refactor the auth module to use JWT");
console.log(answer);
```

### Via EngineRegistry

```typescript
import { createEngine } from "./src/core/engine/EngineRegistry.js";

const engine = createEngine("langgraph", {
  llm: llmClient,
  telemetry: telemetryService,
  io: myAgentIO,
  options: { maxIterations: 25, validateGoal: true },
});

const answer = await engine.run("Add a health check endpoint");
```

### With Progress Observers

```typescript
const unsubscribe = engine.onProgress((state) => {
  console.log(`[${state.phase}] ${"task" in state ? state.task : ""}`);
});

const answer = await engine.run("Deploy to staging");
unsubscribe();
```

### Cancellation

```typescript
const promise = engine.run("Long running task...");

// Later, from another context:
setTimeout(() => engine.cancel("Timeout exceeded"), 5000);

const answer = await promise;
// answer will be "(Task was cancelled before completion.)"
```

---

## Internal Helpers

### `transition(newState: EngineState)`

Transitions the engine to a new lifecycle state and notifies all registered observers. Observer errors are caught and silently ignored.

### `getTaskFromState()`

Extracts the task description from the current engine state. Returns an empty string if the current state has no `task` property (e.g., when the engine is in the `idle` phase).

### `addUsage(usage: LlmUsage | undefined)`

Accumulates LLM usage statistics across multiple LLM calls within a single run. Increments the internal call counter and adds token counts to the running totals. Null/undefined usage objects are silently ignored.

### `buildSystemPrompt(skills: LoadedSkill[]): string`

Builds the system prompt for the LLM by composing:
1. The protocol prompt (from `buildProtocolPrompt()`)
2. The base xcoder ReAct agent prompt (with workspace context, health score awareness, etc.)
3. Skill-specific directives (if any skills were selected for this task)

The result is wrapped in `<task_context>` XML tags.

### `extractPartialSuccessContext(messages, iterationCount, restartCount)`

Walks the message history in reverse and captures up to 10 tool calls, their results, files modified, files read, commands run, and the last assistant thought. Stored in `this.partialSuccess`.

### `synthesizeReport(taskDescription, messages, currentFinalContent, maxIterations, restartCount)`

Synthesizes a meaningful report when the engine terminates without a proper final answer. Strategy:
1. If `currentFinalContent` is already substantial, return it as-is.
2. Otherwise, attempt `callLlmForSummary()`.
3. Fall back to mechanical reconstruction.

### `callLlmForSummary(taskDescription, messages, maxIterations, restartCount)`

Calls the LLM to generate a structured report with four sections: what was accomplished, what was left undone, key decisions made, and blockers encountered.

---

## Standalone Helper Functions

### `classifyPhase(toolName: string, args: string): Phase`

Classifies a tool call into a ReAct phase based on the tool name and arguments:

| Tool | Phase |
|------|-------|
| `glob_tool`, `grep_tool`, `read_tool` | `"search"` |
| `playwright_run_tool` | `"validation"` |
| `github_tool` with read-only actions (clone, fetch, pull, status) | `"search"` |
| `github_tool` with write actions (commit, push) | `"action"` |
| `write_edit_tool`, `ssh_tool`, `schedule_task_tool`, `docker_deploy_ssh_tool` | `"action"` |
| `run_command_tool` with test/lint/type-check commands | `"validation"` |
| `run_command_tool` with other commands | `"action"` |
| All other tools | `"action"` |

### `deriveThought(response): string`

Extracts the thought/reasoning text from an LLM response. Prefers `content` (the assistant's visible response), falls back to `reasoningContent` (the model's internal chain-of-thought, if available). If neither is present, returns a placeholder string: `"(no explicit reasoning before this action)"`.

### `safeParse(json: string): unknown`

Safely parses a JSON string without throwing. Returns the parsed object on success, or the original string on parse failure. Used to safely parse tool call arguments that may be malformed JSON.

---

## Engine Registration

The `LangGraphEngine` is registered in `EngineRegistry.ts` under the name `"langgraph"`:

```typescript
registerEngine("langgraph", ({ llm, telemetry, io, options }) => {
  const lgOpts: LangGraphEngineOptions = {
    maxIterations: options?.maxIterations,
    cwd: options?.cwd,
    validateGoal: options?.validateGoal,
    maxValidatorRetries: options?.maxValidatorRetries,
    selfHealing: options?.selfHealing,
    consoleThoughts: options?.consoleThoughts,
    io,
  };
  return new LangGraphEngine(llm, telemetry, lgOpts);
});
```

It can be instantiated via `createEngine("langgraph", deps)` alongside the other registered engines (`"react"` for `ReActOrchestrator`, `"lean"` for `LeanEngine`).

---

## Related Files

| File | Purpose |
|------|---------|
| `src/core/engine/LangGraphEngine.ts` | The engine implementation |
| `src/core/engine/IReactEngine.ts` | Engine interfaces (`IReactEngine`, `IReactEngineV2`) |
| `src/core/engine/EngineRegistry.ts` | Engine factory registry |
| `src/core/engine/LeanEngine.ts` | Alternative procedural ReAct loop engine |
| `src/core/types.ts` | Shared types (`LlmMessage`, `ToolCall`, `LlmClient`, etc.) |
| `src/tools/toolSchemas.ts` | Tool schema definitions exposed to the LLM |
| `src/tools/toolDispatcher.ts` | Tool call dispatch logic |
| `src/core/goalValidator.ts` | Goal validation logic |
| `src/core/stepScorer.ts` | Health scoring logic |
| `src/core/protocol.ts` | Protocol prompt builder |
| `src/core/skillRegistry.ts` | Skill routing and loading |
| `src/core/io/AgentIO.ts` | I/O abstraction interface |
| `src/core/io/AutoIO.ts` | Default I/O implementation |