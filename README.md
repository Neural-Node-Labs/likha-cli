# xcoder

**xcoder** — a ReAct CLI agent with hot-pluggable role skills, DeepSeek by default.

- **Version:** 0.2.0
- **License:** MIT
- **Engine:** TypeScript (Node.js), ReAct loop with multiple engine implementations

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Engines](#engines)
- [Duplicate Action Detection](#duplicate-action-detection)
- [Self-Healing Health Score](#self-healing-health-score)
- [Goal Validation](#goal-validation)
- [Configuration](#configuration)
- [Development](#development)

---

## Overview

xcoder is a CLI agent that follows the **ReAct** (Reasoning + Acting) pattern: it iteratively
thinks about a task, calls tools to gather information or make changes, observes the results,
and repeats until the task is complete. It supports multiple orchestration engines, hot-pluggable
skill directives, and a built-in self-healing mechanism that detects when the agent is stuck.

### Key Features

- **ReAct loop** with Search → Action → Validation phases
- **Multiple engine implementations** — standard ReAct, LeanEngine, LangGraph, Swarm
- **Duplicate action detection** — prevents wasteful repeated tool calls
- **Self-healing health scoring** — detects stalled progress and nudges the agent
- **Goal validation** — independent verification before accepting completion
- **Phase planning** — divides complex tasks into isolated phases
- **Subagent delegation** — offloads work to isolated sub-agents
- **Context compaction** — collapses stale file reads to save tokens
- **Persistent task history** — SQLite/Postgres-backed

---

## Architecture

```
src/
├── cli/              # CLI entry point (Commander)
├── api/              # Express API server
├── core/             # Core orchestration logic
│   ├── engine/       # Engine implementations
│   ├── io/           # I/O abstractions (AutoIO, AgentIO)
│   └── ...
├── tools/            # Tool implementations (20+ tools)
├── llm/              # LLM client (DeepSeek, mock)
├── indexing/         # Workspace indexing
├── config/           # Configuration loading
├── db/               # Database layer (SQLite, Postgres)
├── remote/           # SSH/SCP remote operations
├── telemetry/        # Logging and telemetry
└── test/             # Test suite
```

---

## Engines

xcoder provides four engine implementations, all interchangeable via the `IReactEngine` interface:

| Engine | Description |
|--------|-------------|
| **ReActOrchestrator** | Full-featured default engine with plan mode, phase planning, subagent delegation, and goal validation |
| **LeanEngine** | Focused, self-contained ReAct loop — the core loop without plan mode or subagents |
| **LangGraphEngine** | ReAct loop built on `@langchain/langgraph`'s StateGraph with explicit two-node state machine |
| **SwarmEngine** | Parallel swarm orchestration with WBS decomposition and concurrent agent dispatch |

---

## Duplicate Action Detection

xcoder includes a deterministic duplicate-action detection system that prevents the agent from
wasting iterations on repeated tool calls that produce no new information. This is a core part
of the self-healing mechanism and runs on every tool step at zero additional LLM cost.

### What Constitutes a Duplicate

A tool call is flagged as a **duplicate action** when **all three** of these conditions are met:

1. **Same tool** — the exact same tool name (e.g., `run_command_tool`, `read_tool`)
2. **Same arguments** — the exact same arguments (compared via stable JSON serialization)
3. **Same observation** — the tool produced the **identical** result every time it was called

This deliberately does **not** flag legitimate re-runs. For example, running a test command
after editing a file is expected ReAct behavior — the observation will be different because
the underlying state changed. Only genuinely wasteful repeats (same call, same result, no new
information) are flagged.

### How Detection Works

Detection is implemented in `src/core/duplicateActionDetector.ts`:

1. **Grouping** — All tool call records in the current run are grouped by a composite key of
   `tool::stableStringify(args)`.
2. **Filtering** — Groups with fewer than 2 calls are ignored (no repetition).
3. **Observation comparison** — For groups with 2+ calls, the observations are compared using
   stable JSON serialization. If every observation in the group is identical, the group is
   flagged as a violation.
4. **Reporting** — Each violation records the tool name, arguments, occurrence count, and a
   human-readable reason.

The `stableStringify` function ensures deterministic key ordering for object arguments,
so `{a:1, b:2}` and `{b:2, a:1}` produce the same key and are correctly recognized as
the same call.

### What Happens When a Duplicate Is Found

When a duplicate action is detected, two things happen:

#### 1. Health Score Penalty

The `stepScorer.ts` module (`scoreStep` function) applies a **-35 point penalty** to the
step's health score when it's identified as a duplicate. The scoring logic:

| Condition | Score Adjustment |
|-----------|-----------------|
| Baseline (completed step) | 70 |
| Tool call succeeded | +10 |
| Tool call errored | -45 |
| **Duplicate action detected** | **-35** |
| `write_edit_tool` or `run_command_tool` succeeded | +10 |

The final score is clamped to 0–100.

#### 2. Self-Healing Nudge

When the rolling health score (average of the last 5 steps) drops **below 40**, and at least
**3 iterations** have passed since the last nudge, the orchestrator injects a self-check
message into the conversation:

> `[self-check] Your last several steps haven't been making much progress (rolling health score: X/100 — errors and/or repeated identical actions with no new information). Before continuing: re-read the current state of whatever you're working on rather than assuming, double-check your last assumption was actually correct, and consider a genuinely different approach instead of retrying something similar.`

This nudge is purely heuristic — no extra LLM calls, no added cost or latency. It's a
lightweight signal that helps the agent recognize when it's stuck in a loop.

### Configuration Options

Duplicate action detection and self-healing are controlled by the `selfHealing` option:

```ts
interface OrchestratorOptions {
  /**
   * When true (default), scores each tool step heuristically and, if the
   * rolling average drops low, injects a one-time nudge into context asking
   * the model to reconsider its approach instead of continuing down a stuck
   * path. Purely heuristic — no extra LLM calls, no added cost/latency.
   */
  selfHealing?: boolean; // default: true
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `selfHealing` | `boolean` | `true` | Enable/disable health scoring and duplicate detection entirely |
| `maxIterations` | `number` | `20` | Maximum ReAct iterations before forced stop (indirectly limits duplicate cycles) |

When `selfHealing` is `false`, no scoring or nudging occurs — `scoreStep()` is never
called, so the call history is not populated and duplicate actions are not tracked.

### Best Practices

- **Duplicate detection is automatic** — no configuration needed beyond the default settings.
- **Legitimate re-runs are not penalized** — running the same test after an edit produces a
  different observation and is correctly treated as progress.
- **The health score is a rolling average** — a single bad step won't trigger a nudge; it
  takes sustained low scores (below 40 over 5 steps) to activate.
- **The nudge has a cooldown** — at least 3 iterations must pass between nudges to prevent
  spamming the agent.

---

## Self-Healing Health Score

The health score is a rolling 0–100 metric that tracks whether the agent is making progress.
It's computed by `stepScorer.ts` and updated after every tool call.

- **Rolling window:** Last 5 steps (configurable)
- **Threshold:** Below 40 triggers a self-healing nudge
- **Cost:** Zero — purely deterministic, no LLM calls
- **Persistence:** Tracked per-run in `HealthState` and exposed via `getHealthScore()`

---

## Goal Validation

Before accepting a completion, xcoder runs an independent goal validator that checks whether
the agent's claimed completion is actually supported by the recorded observations.

- **Enabled by default** (`validateGoal: true`)
- **Max retries:** 2 (`maxValidatorRetries`)
- **On rejection:** The rejection reason is fed back into the conversation for correction
- **On exhaustion:** After max retries, the answer is accepted without verification

---

## Configuration

xcoder is configured via the `OrchestratorOptions` interface passed to the orchestrator or
engine constructor. Key options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxIterations` | `number` | `20` | Max ReAct iterations per round |
| `planMode` | `"auto" \| "always" \| "never"` | `"auto"` | When to enter plan mode |
| `validateGoal` | `boolean` | `true` | Enable goal validation |
| `selfHealing` | `boolean` | `true` | Enable health scoring and duplicate detection |
| `leanToken` | `boolean` | `true` | Enable context compaction |
| `singlePhase` | `boolean` | `false` | Disable phase planning |
| `interactive` | `boolean` | `true` | Enable stdin prompts |
| `auto` | `boolean` | `false` | Fully autonomous mode (no prompts) |
| `isolatedWorkspace` | `boolean` | `false` | Run in isolated workspace copy |

---

## Development

```bash
# Install dependencies
npm run xcoder:install

# Build
npm run build

# Run tests
npm test

# Run in development mode
npm run dev -- --task "your task description"

# Run as CLI
npm start -- --task "your task description"

# Start API server
npm run xcoder:api
```

### Project Structure

- `src/core/` — Core orchestration, engines, types, and protocols
- `src/tools/` — Tool implementations and dispatcher
- `src/llm/` — LLM client integrations
- `src/cli/` — CLI entry point
- `src/api/` — Express API server
- `src/db/` — Database layer
- `src/test/` — Test suite (Vitest)
- `agent/` — Skill definitions and protocol files
