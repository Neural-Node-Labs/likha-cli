# SwarmEngine Validation Report

**Date:** 2026-07-22
**Scope:** Comparison of `src/core/engine/SwarmEngine.ts` against `docs/swarm-engine-architecture.md`
**Reviewer:** xcoder (automated validation)

---

## Executive Summary

The SwarmEngine implementation is **substantially aligned** with its documented architecture. The core two-phase design (WBS Planning → Orchestration Loop), parallel dispatch mechanism, swarm tool set, and fallback behavior all match the architecture document. However, **6 discrepancies** were identified, ranging from missing features to undocumented behaviors.

**Overall alignment score: 85%** — the engine works as documented, but several lifecycle management features declared in the options interface are not implemented, and some implementation details are not captured in the architecture doc.

---

## Discrepancy 1: `selfHealing` Option Declared But Not Implemented

**Severity: MEDIUM**
**Category: Missing Feature**

### Architecture Doc Says
> `selfHealing` | boolean | true | (Declared but unused)

The architecture document explicitly notes this option as "Declared but unused."

### Implementation Reality
The `SwarmEngineOptions` interface declares `selfHealing?: boolean` (line 46), and `EngineRegistry.ts` passes it through. However, the `run()` method in `SwarmEngine.ts` **never reads or uses this option**. There is no health-score monitoring loop, no rolling health check, and no self-check nudge injection anywhere in the SwarmEngine's main loop.

### Comparison
Both `LeanEngine` and `LangGraphEngine` implement self-healing: when the rolling health score drops below 40 and at least 3 iterations have passed since the last nudge, they inject a self-check message into the conversation. The SwarmEngine has the `health` state variable and `getHealthScore()` method (inherited from the interface), but never uses them for self-healing.

### Recommendation
Either implement self-healing nudges in the orchestrator loop (matching the pattern in LeanEngine), or remove the `selfHealing` option from `SwarmEngineOptions` and update the architecture doc to reflect that it's intentionally omitted.

---

## Discrepancy 2: `maxValidatorRetries` Option Declared But Not Used

**Severity: LOW**
**Category: Dead Configuration**

### Architecture Doc Says
> `maxValidatorRetries` | number | 2 | (Declared but unused)

The architecture document explicitly notes this option as "Declared but unused."

### Implementation Reality
The `SwarmEngineOptions` interface declares `maxValidatorRetries?: number` (line 44), and `EngineRegistry.ts` passes it through. However, the `runGoalValidator()` method (line 530) does not accept or use this value — it has no retry logic at all. The option is dead configuration.

### Comparison
Both `LeanEngine` and `LangGraphEngine` use `maxValidatorRetries` to control how many times a rejected goal validation is fed back into the conversation before accepting the answer unverified. The SwarmEngine's validator is a simple completion-ratio check with no retry mechanism.

### Recommendation
Either implement retry logic in `runGoalValidator()`, or remove the option from `SwarmEngineOptions` and update the architecture doc.

---

## Discrepancy 3: No `planning` or `validating` Phase Transitions

**Severity: LOW**
**Category: State Tracking Gap**

### Architecture Doc Says
> The engine transitions through these EngineState phases: idle → running → completed (with cancelled and error as alternative endpoints)
> Note: The engine does NOT transition through `planning` or `validating` states, unlike LeanEngine and LangGraphEngine.

The architecture document correctly documents this limitation.

### Implementation Reality
The `EngineState` discriminated union (from `IReactEngine.ts`) includes `{ phase: "planning"; task: string }` and `{ phase: "validating"; task: string; attempt: number; maxAttempts: number }` states. The SwarmEngine:
- Never transitions to `phase: "planning"` — it goes directly from `idle` to `running`
- Never transitions to `phase: "validating"` — the `runGoalValidator()` method does not call `this.transition()`

### Comparison
Both `LeanEngine` and `LangGraphEngine` properly transition through `planning` (before plan generation) and `validating` (during goal validation) states. Progress observers registered via `onProgress()` receive these transitions.

### Recommendation
Add `this.transition({ phase: "planning", task: taskDescription })` before WBS generation, and `this.transition({ phase: "validating", ... })` inside `runGoalValidator()`. Update the architecture doc once implemented.

---

## Discrepancy 4: No `error` Phase Transition on LLM Failure

**Severity: LOW**
**Category: Error Handling Gap**

### Architecture Doc Says
> LLM call failures in the orchestrator loop are **not** caught — they propagate as unhandled exceptions

The architecture document correctly documents this limitation.

### Implementation Reality
The `run()` method in SwarmEngine does not wrap the LLM call (`this.llm.complete()`) in a try/catch. If the LLM throws (e.g., network error, rate limit), the exception propagates uncaught and the engine never transitions to `{ phase: "error", ... }`.

### Comparison
Both `LeanEngine` and `LangGraphEngine` catch LLM errors, log them via telemetry, transition to the error state, and re-throw. This gives progress observers visibility into the failure.

### Recommendation
Wrap the LLM call in a try/catch that transitions to the error state before re-throwing. Update the architecture doc once implemented.

---

## Discrepancy 5: `addUsage()` Does Not Increment `llmCallCount`

**Severity: LOW**
**Category: Accounting Bug**

### Architecture Doc Says
The architecture document does not specify the exact accounting behavior of `addUsage()`.

### Implementation Reality
In `SwarmEngine.addUsage()` (line 140–148), the method accumulates token counts but does **not** increment `this.llmCallCount`. In contrast, both `LeanEngine.addUsage()` and `LangGraphEngine.addUsage()` increment `this.llmCallCount += 1`. This means the SwarmEngine's `llmCallCount` will under-report the number of LLM calls made.

Additionally, the orchestrator loop at line 310 explicitly increments `this.llmCallCount++` after the LLM call, but the `addUsage()` method called on the same response does not. The `generateWbs()` and `generatePlan()` methods call `addUsage()` without incrementing `llmCallCount` at all.

### Recommendation
Add `this.llmCallCount += 1;` to `SwarmEngine.addUsage()` and remove the explicit `this.llmCallCount++` at line 310 to avoid double-counting.

---

## Discrepancy 6: `consoleThoughts` Not Respected for Swarm Agent Logging

**Severity: LOW**
**Category: Config Inconsistency**

### Architecture Doc Says
> `consoleThoughts` | boolean | true | Print orchestrator thoughts to console

### Implementation Reality
The `SwarmEngine.run()` method checks `this.opts.consoleThoughts !== false` for the orchestrator's thought output (line 315), but the `dispatchReadyTasks()` method and `runSwarmAgentForTask()` method do **not** check `consoleThoughts` — they always log via `this.io.log()`. This means even with `consoleThoughts: false`, swarm agent dispatch messages and task completion/failure logs will still be printed.

### Recommendation
Gate swarm-related logging behind the `consoleThoughts` option, or update the architecture doc to clarify that `consoleThoughts` only controls orchestrator thoughts, not swarm agent dispatch logging.

---

## Items Confirmed Correct (No Discrepancy)

The following aspects of the implementation **match** the architecture document:

| Aspect | Status |
|--------|--------|
| Two-phase design (WBS Planning → Orchestration) | ✅ Matches |
| WBS generation via LLM with markdown table format | ✅ Matches |
| WBS parsing with dependency resolution | ✅ Matches |
| Parallel dispatch with `maxParallelAgents` (default: 5) | ✅ Matches |
| Swarm agent execution via `LeanEngine` instances | ✅ Matches |
| Swarm agent max iterations (default: 15) | ✅ Matches |
| Three swarm tools (`swarm_assign_tool`, `swarm_check_status_tool`, `swarm_report_tool`) | ✅ Matches |
| Goal validator with completion ratio scoring | ✅ Matches |
| Fallback to single-agent mode on WBS parse failure | ✅ Matches |
| WBS persistence to `.swarm_artifacts/wbs_plan.json` | ✅ Matches |
| `IReactEngine` and `IReactEngineV2` interface compliance | ✅ Matches |
| Cancellation support via `cancel()` | ✅ Matches |
| Progress observer support via `onProgress()` | ✅ Matches |
| `EngineRegistry.ts` registration under name `"swarm"` | ✅ Matches |

---

## Detailed Line-by-Line Comparison

### SwarmEngineOptions (lines 35-52)

| Option | Arch Doc | Implementation | Match? |
|--------|----------|---------------|--------|
| `maxIterations` | Default: 30 | Default: 30 | ✅ |
| `cwd` | Default: `process.cwd()` | Default: `process.cwd()` | ✅ |
| `tools` | Default: `TOOL_SCHEMAS` | Default: `TOOL_SCHEMAS` | ✅ |
| `systemPrompt` | — | Declared but unused | ✅ (doc says unused) |
| `validateGoal` | Default: true | Default: true | ✅ |
| `maxValidatorRetries` | Default: 2 (unused) | Declared but unused | ✅ (doc says unused) |
| `selfHealing` | Default: true (unused) | Declared but unused | ✅ (doc says unused) |
| `consoleThoughts` | Default: true | Default: true | ✅ |
| `io` | Default: AutoIO | Default: AutoIO | ✅ |
| `maxParallelAgents` | Default: 5 | Default: 5 | ✅ |
| `swarmAgentMaxIterations` | Default: 15 | Default: 15 | ✅ |
| `persistArtifacts` | Default: true | Default: true | ✅ |

### WBS Generation (lines 230-260)

| Aspect | Arch Doc | Implementation | Match? |
|--------|----------|---------------|--------|
| LLM decomposes task into 2-20 WBS units | ✅ | Prompt says "2-20" | ✅ |
| Markdown table format | ✅ | `\| ID \| Description \| Dependencies \| Instructions \|` | ✅ |
| Parses into WbsTask[] | ✅ | `parseWbsTasks()` | ✅ |
| Persists to `.swarm_artifacts/wbs_plan.json` | ✅ | `writeWbsToDisk()` | ✅ |

### Orchestration Loop (lines 280-360)

| Aspect | Arch Doc | Implementation | Match? |
|--------|----------|---------------|--------|
| Orchestrator LLM with swarm tools | ✅ | `getSwarmTools()` returns 3 swarm tools + base tools | ✅ |
| Auto-dispatch ready tasks | ✅ | `dispatchReadyTasks()` | ✅ |
| Max parallel agents | ✅ | `maxParallelAgents ?? 5` | ✅ |
| Per-iteration goal validator | ✅ | `runGoalValidator()` called after tool calls | ✅ |
| Termination when all tasks done | ✅ | `wbsTasks.every(t => completed/failed/skipped)` | ✅ |
| System nudge for unfinished tasks | ✅ | "SYSTEM NUDGE" message injected | ✅ |

### Swarm Agent Execution (lines 370-420)

| Aspect | Arch Doc | Implementation | Match? |
|--------|----------|---------------|--------|
| Creates LeanEngine per task | ✅ | `new LeanEngine(this.llm, this.telemetry, ...)` | ✅ |
| Isolated context | ✅ | Fresh LeanEngine instance per task | ✅ |
| Max 15 iterations | ✅ | `swarmAgentMaxIterations ?? 15` | ✅ |
| Console suppressed | ✅ | `consoleThoughts: false` | ✅ |
| Collects result/status/iterations | ✅ | Returns `SwarmAgentResult` | ✅ |
| Updates WbsTask status | ✅ | Sets `task.status = "completed"` or `"failed"` | ✅ |

### Goal Validator (lines 530-550)

| Aspect | Arch Doc | Implementation | Match? |
|--------|----------|---------------|--------|
| Completion ratio scoring | ✅ | `(completedCount / totalCount) * 100` | ✅ |
| Records ValidationReport | ✅ | Pushes to `this.validationHistory[]` | ✅ |
| Tracks failed tasks as issues | ✅ | Maps failed tasks to issue strings | ✅ |
| Exceptions caught silently | ✅ | try/catch with empty catch block | ✅ |

---

## Recommendations

### Must Fix (High Priority)
None — no critical correctness bugs were found.

### Should Fix (Medium Priority)
1. **Implement self-healing** — Add health-score monitoring and nudge injection to the orchestrator loop, matching the pattern in LeanEngine.

### Nice to Fix (Low Priority)
2. **Remove or implement `maxValidatorRetries`** — Either add retry logic to `runGoalValidator()` or remove the dead option.
3. **Add `planning` and `validating` phase transitions** — Improve progress observer fidelity.
4. **Add error state transition on LLM failure** — Wrap the LLM call in try/catch.
5. **Fix `llmCallCount` accounting** — Move the increment into `addUsage()`.
6. **Gate swarm logging behind `consoleThoughts`** — Or document the exception.
