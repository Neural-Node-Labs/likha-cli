# SwarmEngine Architecture

## Overview

SwarmEngine is a parallel task-execution engine that implements both `IReactEngine` and `IReactEngineV2` interfaces. Unlike the single-threaded ReAct loop in `LeanEngine` or the graph-based `LangGraphEngine`, SwarmEngine distributes work across multiple parallel agents using a Work Breakdown Structure (WBS) planning phase followed by an orchestration phase.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    SwarmEngine.run()                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Phase 1: Planning (WBS Generation)                   │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │  generateWbs() → LLM decomposes task into       │   │   │
│  │  │  2-20 WBS units with ID, Description,           │   │   │
│  │  │  Dependencies, Instructions                     │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  │         │                                              │   │
│  │         ▼                                              │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │  parseWbsTasks() → Parses markdown table into   │   │   │
│  │  │  WbsTask[] objects with status tracking         │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  │         │                                              │   │
│  │         ▼ (if 0 tasks parsed → fallback to single)    │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │  writeWbsToDisk() → Persists WBS to             │   │   │
│  │  │  .swarm_artifacts/wbs_plan.json                 │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Phase 2: Orchestration Loop                          │   │
│  │                                                       │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │  Orchestrator LLM (system prompt + tools)       │   │   │
│  │  │  - swarm_assign_tool: dispatch a WBS task       │   │   │
│  │  │  - swarm_check_status_tool: query task status   │   │   │
│  │  │  - swarm_report_tool: get task results          │   │   │
│  │  │  - All standard tools (glob, grep, read, etc.)  │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  │         │                                              │   │
│  │         ▼                                              │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │  dispatchReadyTasks() (auto-dispatch)           │   │   │
│  │  │  - Finds pending tasks with all deps completed  │   │   │
│  │  │  - Runs up to maxParallelAgents concurrently    │   │   │
│  │  │  - Each task → runSwarmAgentForTask()           │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  │         │                                              │   │
│  │         ▼                                              │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │  runSwarmAgentForTask()                         │   │   │
│  │  │  - Creates a LeanEngine instance per task       │   │   │
│  │  │  - Runs with isolated context (max 15 iters)    │   │   │
│  │  │  - Collects result, status, iteration count     │   │   │
│  │  │  - Updates WbsTask status (completed/failed)    │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  │         │                                              │   │
│  │         ▼                                              │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │  runGoalValidator() (per-iteration check)       │   │   │
│  │  │  - Computes completion ratio (completed/total)  │   │   │
│  │  │  - Records ValidationReport with score/verdict  │   │   │
│  │  │  - Tracks failed tasks as issues                │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Termination Conditions                               │   │
│  │  - All tasks completed/failed/skipped → return        │   │
│  │  - maxIterations (default: 30) reached → partial      │   │
│  │  - Cancelled via cancel() → partial_success           │   │
│  │  - Fallback: 0 WBS tasks parsed → runSingleAgent()    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. SwarmEngineOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxIterations` | number | 30 | Max orchestrator loop iterations |
| `cwd` | string | `process.cwd()` | Working directory |
| `tools` | ToolSchema[] | `TOOL_SCHEMAS` | Tool schemas for the orchestrator LLM |
| `systemPrompt` | string | — | Custom system prompt override |
| `validateGoal` | boolean | true | Enable per-iteration goal validation |
| `maxValidatorRetries` | number | 2 | (Declared but unused) |
| `selfHealing` | boolean | true | (Declared but unused) |
| `consoleThoughts` | boolean | true | Print orchestrator thoughts to console |
| `io` | AgentIO | AutoIO | I/O adapter |
| `maxParallelAgents` | number | 5 | Max concurrent swarm agents |
| `swarmAgentMaxIterations` | number | 15 | Max iterations per swarm agent |
| `persistArtifacts` | boolean | true | Persist WBS to `.swarm_artifacts/` |

### 2. WbsTask Interface

```typescript
interface WbsTask {
  id: string;           // e.g. "T1", "T2"
  description: string;  // Short description
  details: string;      // Detailed execution instructions
  dependencies: string[]; // IDs of tasks that must complete first
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  result?: string;      // Output from the swarm agent
  agentId?: string;     // Assigned agent identifier
  iterationCount?: number; // Iterations used by the agent
  error?: string;       // Error message if failed
}
```

### 3. Swarm Tools (Orchestrator LLM)

The orchestrator LLM has access to three swarm-specific tools in addition to all standard tools:

- **`swarm_assign_tool(taskId: string)`** — Manually dispatch a WBS task to a swarm agent. Returns the agent's result.
- **`swarm_check_status_tool()`** — Returns the current status of all WBS tasks as JSON.
- **`swarm_report_tool(taskId: string)`** — Returns the detailed result of a completed task.

### 4. Parallel Dispatch

The `dispatchReadyTasks()` method automatically finds pending tasks whose dependencies are all completed and runs them concurrently (up to `maxParallelAgents`). Each task runs in its own `LeanEngine` instance with:
- Isolated message history
- `maxIterations` set to `swarmAgentMaxIterations` (default: 15)
- Console output suppressed (`consoleThoughts: false`)
- Shared `LlmClient` and `TelemetryInterface`

### 5. Goal Validator

The `runGoalValidator()` method runs after each orchestrator iteration (when `validateGoal` is enabled). It:
- Computes a completion score: `(completed / total) * 100`
- Records a `ValidationReport` with iteration number, score, verdict (pass/warn/fail), issues (failed tasks), and health score
- Stores reports in `this.validationHistory[]`

### 6. Lifecycle State Transitions

```
idle → running → completed
  │        │
  │        ├── cancelled (via cancel())
  │        └── error (on LLM failure — NOT IMPLEMENTED)
```

The engine transitions through these `EngineState` phases:
- `idle` — constructed, not yet running
- `running` — actively executing (both Phase 1 and Phase 2)
- `cancelled` — cancelled by caller
- `completed` — finished normally or with partial success

Note: The engine does NOT transition through `planning` or `validating` states, unlike LeanEngine and LangGraphEngine.

### 7. Fallback: Single-Agent Mode

If `parseWbsTasks()` returns zero tasks (WBS parsing failure), the engine falls back to `runSingleAgent()`, which creates a `LeanEngine` instance and runs the task as a standard single-agent ReAct loop.

### 8. Persistence

When `persistArtifacts` is enabled (default: true), the WBS plan is written to `.swarm_artifacts/wbs_plan.json` as a JSON file with the task description and full task list.

## Interface Compliance

SwarmEngine implements both `IReactEngine` and `IReactEngineV2`:

### IReactEngine Methods
- `run(taskDescription, runOpts?)` — Main execution
- `generatePlan(taskDescription)` — WBS-based plan generation
- `selectSkills(taskDescription)` — Skill routing
- `getLastOutcome()` — Run outcome
- `getCumulativeUsage()` — Token usage
- `getHealthScore()` — Rolling health score
- `getPartialSuccess()` — Partial success context
- `getSubagentLimitContext()` — Subagent limit context

### IReactEngineV2 Methods
- `cancel(reason?)` — Cancel execution
- `onProgress(observer)` — Register progress observer
- `getState()` — Current lifecycle state
- `getLastMessages()` — Last message history
- `getWorkspacePath()` — Working directory
- `getIterationCount()` — Total iterations

## Error Handling

- LLM call failures in the orchestrator loop are **not** caught — they propagate as unhandled exceptions
- Swarm agent failures (via `runSwarmAgentForTask()`) are caught and recorded as task status `"failed"` with the error message
- WBS persistence failures are caught and logged as warnings
- Observer errors are caught and silently ignored
- Goal validator exceptions are caught and silently ignored

## Usage

```typescript
const engine = new SwarmEngine(llmClient, telemetryService, {
  maxIterations: 30,
  maxParallelAgents: 5,
  swarmAgentMaxIterations: 15,
  validateGoal: true,
  consoleThoughts: true,
});

const answer = await engine.run("Refactor the auth module to use JWT");
```

The engine is registered in `EngineRegistry.ts` under the name `"swarm"` and can be instantiated via `createEngine("swarm", deps)`.
