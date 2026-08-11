# xcoder — Solution Design Document

**Version:** 0.2.0  
**Last Updated:** 2026-07-23  
**Status:** Living document — updated to reflect current implementation

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Component Architecture](#3-component-architecture)
4. [Data Flow](#4-data-flow)
5. [Key Modules](#5-key-modules)
6. [Engine Architecture](#6-engine-architecture)
7. [Tool System](#7-tool-system)
8. [Skill System](#8-skill-system)
9. [Self-Healing & Health Scoring](#9-self-healing--health-scoring)
10. [Persistence Layer](#10-persistence-layer)
11. [API Server & UI](#11-api-server--ui)
12. [Design Decisions & Trade-offs](#12-design-decisions--trade-offs)
13. [Deployment Architecture](#13-deployment-architecture)
14. [Sequence Diagrams](#14-sequence-diagrams)

---

## 1. Overview

xcoder is a **ReAct (Reasoning + Acting) CLI agent** that iteratively thinks about a task, calls tools to gather information or make changes, observes the results, and repeats until the task is complete. It is built in TypeScript (Node.js) and uses DeepSeek as its default LLM.

### Core Principles

- **ReAct loop** — Search → Action → Validation phases per iteration
- **Hot-pluggable engines** — Multiple orchestration strategies via a common interface
- **Skill system** — 30+ specialized role skills injected into the system prompt
- **Self-healing** — Heuristic health scoring detects stalled progress and nudges the agent
- **Verification before done** — Independent goal validation before accepting completion
- **Context economy** — Stale file reads are compacted to save tokens

### Key Capabilities

| Capability | Description |
|-----------|-------------|
| CLI agent | ReAct loop with 20+ tools for filesystem, SSH, Docker, git, testing |
| Multiple engines | Standard ReAct, LeanEngine, LangGraph, Swarm — interchangeable via factory |
| Plan mode | Generates a task plan before execution, with user approval |
| Phase planning | Divides complex tasks into sequential phases with isolated context |
| Subagent delegation | Offloads work to isolated sub-orchestrators |
| Goal validation | Independent LLM call verifies completion before accepting |
| Context compaction | Collapses stale file reads to save tokens (lean-token mode) |
| Duplicate detection | Both action-level and reasoning-level duplicate detection |
| Health scoring | Rolling 0-100 heuristic score per step, with self-healing nudges |
| HTTP API | Express-based REST API for remote task execution |
| React UI | Vite + TypeScript frontend for managing tasks, plans, and telemetry |
| Database | SQLite (default) and PostgreSQL for persistent storage |
| Remote deploy | Docker Compose deployment via SSH to local or remote hosts |
| Fleet operations | Multi-host SSH command execution and file copy |

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLI (Commander)                                │
│  src/cli/index.ts → parses args, dispatches to engine or API server         │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
┌─────────────────┐ ┌─────────┐ ┌──────────┐
│  EngineRegistry │ │  API    │ │  UI      │
│  (Factory)      │ │  Server │ │  (React) │
└────────┬────────┘ └─────────┘ └──────────┘
         │
    ┌────┴──────────────────────────────┐
    │                                   │
    ▼                                   ▼
┌──────────────────┐    ┌──────────────────────────┐
│  IReactEngine    │    │  IReactEngineV2          │
│  (Interface)     │    │  (V2 Lifecycle)          │
└──────────────────┘    └──────────────────────────┘
         │
    ┌────┴───────────┬───────────┬───────────┐
    ▼                ▼           ▼           ▼
┌──────────┐  ┌──────────┐ ┌──────────┐ ┌──────────┐
│ ReAct    │  │ Lean     │ │ LangGraph│ │ Swarm    │
│ Orchest. │  │ Engine   │ │ Engine   │ │ Engine   │
└──────────┘  └──────────┘ └──────────┘ └──────────┘
    │              │            │            │
    └──────────────┴────────────┴────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  Tool Dispatcher │
              │  (20+ tools)     │
              └────────┬─────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   ┌─────────┐   ┌──────────┐  ┌──────────┐
   │Filesys. │   │  SSH/    │  │  LLM     │
   │ Tools   │   │  Remote  │  │  Client  │
   └─────────┘   └──────────┘  └──────────┘
```

### Layer Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Presentation                       │
│  CLI (Commander)  │  API (Express)  │  UI (React)    │
├──────────────────────────────────────────────────────┤
│                   Orchestration                       │
│  EngineRegistry → IReactEngine → 4 Engine Impls      │
│  Plan Mode │ Phase Planning │ Subagent Delegation    │
├──────────────────────────────────────────────────────┤
│                   Core Services                       │
│  SkillRegistry │ GoalValidator │ StepScorer          │
│  ContextCompaction │ DuplicateDetection              │
│  Protocol Builder │ TaskHistory │ WorkspaceManager   │
├──────────────────────────────────────────────────────┤
│                    Tool Layer                         │
│  ToolDispatcher → 20+ Tool Implementations           │
├──────────────────────────────────────────────────────┤
│                    Infrastructure                     │
│  LLM Client (DeepSeek/Mock) │ DB (SQLite/Postgres)   │
│  Telemetry │ SSH │ Docker │ Cron                     │
└──────────────────────────────────────────────────────┘
```

---

## 3. Component Architecture

### 3.1 CLI Layer (`src/cli/`)

The CLI entry point uses **Commander.js** for argument parsing. It supports:

- Single task execution (`--task` or positional argument)
- Interactive chat mode (`--chat`)
- Workspace indexing (`--index`)
- Skill listing (`--skills`)
- API server mode (`--serve`)
- UI mode (`--ui` — starts both API and React dev server)
- Deploy mode (`--deploy`)
- Audit and diagnostics (`--audit-react`, `--diagnose-live`)

**Key files:**
- `src/cli/index.ts` — Argument parsing and dispatch
- `src/cli/CliIO.ts` — Terminal I/O with ANSI colors, spinners, stdin prompts

### 3.2 API Layer (`src/api/`)

Express-based REST API server with:

- **Token-based authentication** — Bearer token required for all endpoints except health, login, register, and user count
- **First-user registration** — First user becomes admin; subsequent users added by admin
- **Two-phase chat flow** — `/chat/plan` generates a plan and returns a sessionId; `/chat/execute` executes the approved plan
- **Database-backed stores** — TaskHistoryStore, PhaseReportStore, WbsStore, PlanStore, ProjectStore

**Key files:**
- `src/api/server.ts` — Server startup with CORS, JSON middleware, error handling
- `src/api/routes.ts` — All API endpoints (chat, telemetry, skills, users, plans, WBS, settings)
- `src/api/auth.ts` — Token generation, verification, password hashing
- `src/api/types.ts` — API request/response type definitions

### 3.3 Core Orchestration (`src/core/`)

The heart of the system. Contains:

- **Engine interface** (`IReactEngine`, `IReactEngineV2`) — Contract for all engines
- **Engine registry** (`EngineRegistry.ts`) — Factory pattern for engine creation
- **Four engine implementations** — ReActOrchestrator, LeanEngine, LangGraphEngine, SwarmEngine
- **Skill system** (`skillRegistry.ts`) — Loads and routes skills from `agent/skills/`
- **Protocol builder** (`protocol.ts`) — Builds system prompt from protocol + lessons + skills
- **Health scoring** (`stepScorer.ts`) — Heuristic 0-100 score per tool step
- **Duplicate detection** — Action-level (`duplicateActionDetector.ts`) and reasoning-level (`iterationReasonDedup.ts`)
- **Goal validation** (`goalValidator.ts`) — Independent LLM call verifies completion
- **Context compaction** (`contextCompaction.ts`) — Collapses stale file reads
- **Task history** (`taskHistory.ts`) — File-based task history (JSONL + markdown)
- **Workspace manager** (`workspaceManager.ts`) — Isolated workspace copies

### 3.4 Tool Layer (`src/tools/`)

20+ tool implementations, each in its own file, dispatched by `toolDispatcher.ts`:

| Category | Tools |
|----------|-------|
| **Filesystem** | `glob_tool`, `grep_tool`, `read_tool`, `write_edit_tool` |
| **Execution** | `run_command_tool` |
| **SSH/Remote** | `ssh_tool`, `ssh_copy_tool`, `ssh_run_command` |
| **Docker** | `docker_compose_deploy_tool`, `docker_deploy_ssh_tool` |
| **Git** | `github_tool` |
| **Testing** | `playwright_run_tool`, `crawl_and_generate_playwright_test_tool` |
| **Web** | `summarize_url_tool`, `crawl_site_mapper_tool`, `api_test_tool` |
| **Scheduling** | `schedule_task_tool` |
| **Indexing** | `indexing_tool`, `workspace_info_tool` |
| **History** | `task_history_tool` |
| **Planning** | `save_plan_tool`, `update_task_status_tool`, `add_plan_task_tool`, `delete_plan_task_tool` |
| **Subagent** | `subagent_tool` |
| **Conversation** | `conversation_tool` |

### 3.5 LLM Layer (`src/llm/`)

- **DeepSeekClient** (`deepseekClient.ts`) — Production LLM client with thinking-mode support
- **MockClient** (`mockClient.ts`) — Test double for unit tests

### 3.6 Database Layer (`src/db/`)

- **SQLite** (`sqliteClient.ts`) — Default local database, file-based
- **PostgreSQL** (`postgresClient.ts`) — Production database via `DATABASE_URL`
- **Migrations** (`migrations.ts`) — Schema management
- **Connection** (`connection.ts`) — Connection lifecycle

### 3.7 Telemetry (`src/telemetry/`)

- **FileTelemetry** (`logger.ts`) — File-based logging to `.log/thinking.log`, `.log/llm.log`, `.log/sys.log`
- **PostgresTelemetry** (`postgresTelemetry.ts`) — Database-backed telemetry for the UI

### 3.8 UI (`ui/`)

React frontend built with Vite + TypeScript:

- **Pages:** Dashboard, Chat, Plans, Task History, Phase Reports, Telemetry, Diagnostics, Settings, Admin, Projects
- **Components:** Shared UI components (Badge, Button, Card, PageHeader)
- **Auth:** AuthContext with token management
- **Theming:** ThemeContext with light/dark mode

---

## 4. Data Flow

### 4.1 Task Execution Flow (CLI)

```
User runs: xcoder --task "Refactor auth module"

1. CLI (index.ts) parses args
2. Creates DeepSeekClient + FileTelemetry
3. Creates engine via EngineRegistry.createEngine("react", deps)
4. Engine.run(taskDescription) is called
   │
   ├─ 4a. SkillRegistry.route(task) → matches skills by trigger keywords
   ├─ 4b. Plan Mode check → if triggered, generate plan → write todo.md → user approval
   ├─ 4c. Phase Planning check → if enabled, divide into phases → execute sequentially
   │
   └─ 4d. ReAct Loop (per phase or single):
       │
       ├─ LLM call: system prompt + task + message history → response
       ├─ If no tool calls → candidate completion → Goal Validator → accept/reject
       ├─ If tool calls → dispatch each → append observations → loop
       │
       └─ Self-healing: scoreStep() after each tool call → if avg < 40 → nudge
```

### 4.2 API Task Execution Flow

```
POST /api/v1/chat { task: "..." }

1. Auth middleware validates Bearer token
2. Resolves project directory (from projectId or active project)
3. Creates DeepSeekClient + FileTelemetry
4. Creates engine with persistToDb: true, interactive: false
5. Optionally generates plan (if plan mode triggered)
6. Runs engine.run(task)
7. Returns structured response with result, usage, health score, limitation
```

### 4.3 Two-Phase Plan Flow

```
POST /api/v1/chat/plan { task: "..." }
  → Generates plan, stores session with sessionId
  → Returns { sessionId, plan }

POST /api/v1/chat/execute { sessionId: "..." }
  → Retrieves session, deletes it (one-time use)
  → Runs engine with planMode: "never"
  → Returns execution result
```

### 4.4 Message Flow in ReAct Loop

```
System Prompt (protocol + skills + workspace info)
  │
  ▼
User Message (task description)
  │
  ▼
┌─────────────────────────────────────────────────────┐
│  ReAct Loop Iteration                                │
│                                                       │
│  1. LLM.complete(messages, { tools })                 │
│     → Returns { content, toolCalls, reasoningContent }│
│                                                       │
│  2. If toolCalls.length === 0:                        │
│     → Candidate completion                            │
│     → Goal Validator checks observations              │
│     → If valid: return final answer                   │
│     → If invalid: feed rejection back, continue       │
│                                                       │
│  3. If toolCalls.length > 0:                          │
│     → Push assistant message (with tool_calls)        │
│     → For each tool call:                             │
│       a. dispatchToolCall() → result                  │
│       b. scoreStep() → health score                   │
│       c. Push tool-role message (observation)         │
│       d. Context compaction (if read/write)           │
│     → Self-healing check → nudge if needed            │
│     → Loop back to step 1                             │
│                                                       │
│  4. If iteration > maxIterations:                     │
│     → Ask user to continue (or auto-continue)         │
│     → If no: synthesize report, return                │
│     → If yes: reset iteration counter, continue       │
└─────────────────────────────────────────────────────┘
```

---

## 5. Key Modules

### 5.1 `src/core/orchestrator.ts` — ReActOrchestrator

The default/reference engine implementation. Full-featured with:

- **Plan Mode** — Generates task plan before execution, writes to `tasks/todo.md`
- **Phase Planning** — Divides tasks into sequential phases with isolated ReAct memory
- **Subagent Delegation** — `subagent_tool` spawns fresh orchestrator instances
- **Goal Validation** — Independent LLM call verifies completion
- **Self-Healing** — Rolling health score with nudges
- **Context Compaction** — Stale file read collapsing
- **Partial Success** — Captures context when iteration limit is hit
- **Iteration Restart** — User can continue past iteration limit

**Key methods:**
- `run(taskDescription, runOpts)` — Main entry point
- `generatePlan(taskDescription)` — Plan generation (no execution)
- `selectSkills(taskDescription)` — Skill routing
- `runPlanMode()` — Plan generation + user approval
- `runPhasePlanning()` — Multi-phase execution
- `runSubagent()` — Delegated sub-orchestrator execution
- `synthesizeReport()` — LLM-generated summary on iteration limit

### 5.2 `src/core/engine/IReactEngine.ts` — Engine Interface

The contract all engines must implement:

```typescript
interface IReactEngine {
  run(taskDescription, runOpts?): Promise<string>;
  generatePlan(taskDescription): Promise<string>;
  selectSkills(taskDescription): LoadedSkill[];
  getLastOutcome(): RunOutcome;
  getCumulativeUsage(): LlmUsage | undefined;
  getHealthScore(): number;
  getPartialSuccess(): PartialSuccessContext | undefined;
  getSubagentLimitContext(): SubagentLimitContext | undefined;
}

interface IReactEngineV2 extends IReactEngine {
  cancel(reason?: string): void;
  onProgress(observer: ProgressObserver): () => void;
  getState(): EngineState;
  getLastMessages(): LlmMessage[];
  getWorkspacePath(): string;
  getIterationCount(): number;
}
```

### 5.3 `src/core/engine/EngineRegistry.ts` — Engine Factory

Factory pattern for engine creation:

```typescript
registerEngine("react", ({ llm, telemetry, io, options }) => new ReActOrchestrator(...));
registerEngine("lean", ({ llm, telemetry, io, options }) => new LeanEngine(...));
registerEngine("langgraph", ({ llm, telemetry, io, options }) => new LangGraphEngine(...));
registerEngine("swarm", ({ llm, telemetry, io, options }) => new SwarmEngine(...));

const engine = createEngine("lean", deps); // throws on unknown name
console.log(listEngines()); // ["react", "lean", "langgraph", "swarm"]
```

### 5.4 `src/core/engine/LeanEngine.ts` — LeanEngine

A focused, self-contained ReAct loop that implements both `IReactEngine` and `IReactEngineV2`. Supports cancellation, progress observers, lifecycle state tracking, and self-healing health scoring. Does NOT include plan mode, phase planning, or subagent delegation — those live in the full ReActOrchestrator.

**Key differences from ReActOrchestrator:**
- No plan mode or phase planning
- No subagent delegation
- Supports V2 lifecycle (cancel, onProgress, getState)
- Cleaner, more testable loop structure

### 5.5 `src/core/engine/LangGraphEngine.ts` — LangGraphEngine

A ReAct loop built on `@langchain/langgraph`'s `StateGraph` with an explicit two-node state machine:

```
START → agent → tools → agent → tools → ... → END
           |                    ^
           +-- (conditional) ---+
```

- **agent node**: calls the LLM with accumulated message history and tool schemas
- **tools node**: dispatches each tool call via `dispatchToolCall()` and appends results
- **conditional edge**: if LLM returns zero tool calls → END; otherwise → tools → agent

Uses `Annotation.Root` for typed state flowing through graph nodes. Supports V2 lifecycle.

### 5.6 `src/core/engine/SwarmEngine.ts` — SwarmEngine

Parallel swarm orchestration with WBS decomposition and concurrent agent dispatch:

1. **Phase 1: Planning** — LLM generates a Work Breakdown Structure (markdown table with ID, Description, Dependencies, Instructions)
2. **Phase 2: Orchestration** — Orchestrator LLM drives tasks to completion using swarm-specific tools:
   - `swarm_assign_tool(taskId)` — Manually dispatch a task
   - `swarm_check_status_tool()` — Get all task statuses
   - `swarm_report_tool(taskId)` — Get detailed task result
3. **Auto-dispatch** — Tasks with no unmet dependencies are automatically dispatched to isolated LeanEngine instances (up to `maxParallelAgents`, default 5)
4. **Circuit breaker** — After 3 consecutive failures, a task is marked "skipped" instead of perpetually retried
5. **Goal validation** — Per-iteration WBS completion scoring
6. **Fallback** — If WBS parsing fails or circular dependencies are detected, falls back to single-agent LeanEngine

### 5.7 `src/core/skillRegistry.ts` — Skill System

Hot-pluggable skill system that loads skills from `agent/skills/<name>/SKILL.md`:

- **Header parsing** — YAML frontmatter with name, role, triggers, composes_with
- **Lazy loading** — Headers parsed at startup; full body loaded only when selected
- **Trigger matching** — Keyword-based routing against task description
- **Composition** — `composes_with` enables multi-skill composition (e.g., programmer + tester)

### 5.8 `src/core/stepScorer.ts` — Health Scoring

Heuristic 0-100 score per tool step (no LLM call — cheap and deterministic):

| Signal | Penalty/Reward |
|--------|---------------|
| Tool call errored | -45 |
| Duplicate action (same tool + args + observation) | -35 |
| Duplicate iteration reason (exact match) | -25 |
| Duplicate iteration reason (case-insensitive) | -20 |
| Duplicate iteration reason (fuzzy match) | -15 |
| write_edit_tool / run_command_tool succeeded | +10 |
| Completed without error | +10 |

Rolling average over last 5 steps. When avg < 40, a self-healing nudge is injected.

### 5.9 `src/core/duplicateActionDetector.ts` — Duplicate Action Detection

Flags a duplicate action ONLY when the exact same (tool, arguments) pair was called more than once AND produced the exact same observation every time. Uses stable JSON stringification for comparison.

### 5.10 `src/core/iterationReasonDedup.ts` — Duplicate Reasoning Detection

Three-pass matching strategy for detecting repeated reasoning:

1. **Exact match** (trimmed string equality) — penalty: -25
2. **Case-insensitive match** — penalty: -20
3. **Fuzzy match** (Levenshtein similarity ≥ 0.85) — penalty: -15

Short-string guard: strings < 20 characters are never fuzzy-matched. Rolling window (default: last 5) prevents flagging old, legitimately similar reasoning.

> **⚠️ Status:** The `thought` parameter is NOT currently passed by any call site. The feature is dormant in production — it only runs in unit tests.

### 5.11 `src/core/goalValidator.ts` — Goal Validation

Independent verification pass before accepting completion:

- Gets NO tools and NO conversation history — only the task, raw observation transcript, and claimed final answer
- Uses `responseFormat: "json_object"` for structured output
- Returns `{ valid: boolean, reason: string }`
- Fail-open: if the validator response is unparseable, defaults to valid
- Max retries: 2 (configurable)

### 5.12 `src/core/contextCompaction.ts` — Context Compaction

Collapses stale/superseded `read_tool` observations to save tokens:

- When a file is read or written again, every strictly earlier `read_tool` observation for that same path is collapsed to `[stale file snapshot omitted — lean token mode]`
- Does NOT touch: assistant `tool_calls`, `reasoning_content`, `tool_call_id` linkage
- Enabled by default; disable with `--full-context-token`

### 5.13 `src/core/protocol.ts` — Protocol Builder

Builds the system prompt from three sources wrapped in XML tags:

- `<system_directive>` + `<engineering_protocol>` — from `xcoder.md`
- `<lessons_learned>` — from `tasks/lessons.md`
- `<task_context>` — base ReAct prompt + skill directives + workspace info

### 5.14 `src/core/io/AgentIO.ts` — I/O Abstraction

The seam between "what the engine wants to communicate" and "how it gets shown":

- **AgentReporter** — One-way reporting (log, warn, thought, action, observation, usage, spinner)
- **AgentPrompter** — Two-way interaction (confirm for plan approval, iteration limit)
- **AutoIO** — Default headless implementation (never reads stdin, auto-answers prompts)
- **CliIO** — Terminal implementation with ANSI colors, spinners, stdin prompts

### 5.15 `src/tools/toolDispatcher.ts` — Tool Dispatcher

Central dispatch for all tool calls with:

- **JSON repair** — `safeParseJson()` with three repair strategies for common LLM JSON errors:
  1. Unescaped double quotes inside string values
  2. Truncated strings (missing closing quote)
  3. Missing closing braces/brackets
- **Required arg validation** — Checks against `TOOL_SCHEMAS` required fields before execution
- **Error handling** — Catches runtime errors and returns structured error observations

### 5.16 `src/llm/deepseekClient.ts` — LLM Client

DeepSeek API client with:

- Thinking-mode support (`reasoning_content` preservation)
- Token usage tracking (prompt, completion, reasoning, cached)
- Tool schema injection for function calling
- Configurable model, temperature, response format

---

## 6. Engine Architecture

### 6.1 Engine Comparison

| Aspect | ReActOrchestrator | LeanEngine | LangGraphEngine | SwarmEngine |
|--------|------------------|------------|-----------------|-------------|
| **Loop structure** | `while(true)` with inline routing | `while(true)` with inline routing | `StateGraph` with explicit nodes + edges | Orchestrator loop + parallel agents |
| **Plan mode** | ✅ Full | ❌ | ❌ | ❌ (uses WBS instead) |
| **Phase planning** | ✅ Full | ❌ | ❌ | ❌ |
| **Subagent delegation** | ✅ Full | ❌ | ❌ | ❌ |
| **V2 lifecycle** | ❌ (partial) | ✅ | ✅ | ✅ |
| **Parallel execution** | ❌ | ❌ | ❌ | ✅ (up to 5 agents) |
| **WBS decomposition** | ❌ | ❌ | ❌ | ✅ |
| **Circuit breaker** | ❌ | ❌ | ❌ | ✅ (3 failures → skip) |
| **Goal validation** | ✅ | ✅ | ✅ | ✅ (WBS-based) |
| **Self-healing** | ✅ | ✅ | ✅ | ✅ |
| **Context compaction** | ✅ | ❌ | ❌ | ❌ |
| **State management** | Local variables | Local variables | GraphState annotation | WBS task array |

### 6.2 Engine Selection

```bash
# Default (full-featured)
xcoder --task "Refactor auth module"

# Lean (focused, no plan mode)
xcoder --engine lean --task "Find all TODO comments"

# LangGraph (graph-based)
xcoder --engine langgraph --task "Analyze test coverage"

# Swarm (parallel)
xcoder --engine swarm --task "Set up CI/CD pipeline"
```

---

## 7. Tool System

### 7.1 Tool Schema Definition

Tools are defined in `src/tools/toolSchemas.ts` as OpenAI-compatible function-calling schemas. Each tool has:

- `name` — Unique identifier (e.g., `glob_tool`, `write_edit_tool`)
- `description` — What the tool does (shown to the LLM)
- `parameters` — JSON Schema for arguments with `required` fields

### 7.2 Tool Dispatch Flow

```
LLM returns tool_calls
  → toolDispatcher.dispatchToolCall(call, cwd)
    → safeParseJson(call.function.arguments)  // JSON repair
    → findMissingRequiredArgs(name, args)      // Validate required fields
    → switch(name) → specific tool implementation
    → Return DispatchResult { toolCallId, toolName, observation, isError }
```

### 7.3 JSON Repair Strategy

The `safeParseJson()` function handles common LLM JSON generation errors:

1. **Fast path** — Native `JSON.parse()` for well-formed JSON
2. **Unescaped quotes** — Walks character-by-character, escaping unescaped double quotes inside string values
3. **Truncated strings** — Appends missing closing quote if string is unterminated at EOF
4. **Missing closers** — Counts open/close braces/brackets and appends what's missing

---

## 8. Skill System

### 8.1 Skill Definition Format

Each skill is a directory `agent/skills/<name>/` containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: programmer
role: Software Engineer
description: Writes correct, minimal, idiomatic code
triggers:
  - refactor
  - implement
  - code
version: "1.0"
requires_tools: []
composes_with:
  - tester
---

## Role
Turns a specification or bug report into correct, minimal, idiomatic code...
```

### 8.2 Skill Loading Flow

```
1. SkillRegistry.loadHeaders() — scans agent/skills/ for SKILL.md files
2. Parses YAML frontmatter → SkillHeader (name, role, triggers, composes_with)
3. SkillRegistry.route(taskDescription) — matches trigger keywords against task
4. Returns skills ranked by match count, highest first
5. SkillRegistry.loadSkill(name) — loads full body (header + markdown body)
6. composes_with skills are also loaded (multi-skill composition)
7. Skill bodies are injected into the system prompt
```

### 8.3 Available Skills (30+)

analyst, architect, aws, azure, conversation, devops, docker, docker-expert, filesystem-management, git-vcs, kafka, kubernetes, kubernetes-expert, openshift, pentester, performance-tester, playwright-ui-tester, programmer, qa-engineer, rca, redhat, rosa, scrum-framework, scrum-master-agent, secops, skill-authoring, software-architect, software-engineer, task-planning, tester, ubuntu, ui-ux-design, workspace-context

---

## 9. Self-Healing & Health Scoring

### 9.1 Two Parallel Health Systems

| System | Scale | Location | Purpose |
|--------|-------|----------|---------|
| **Step-level health** | 0-100 (rolling avg) | `stepScorer.ts` | Per-step heuristic score, drives self-healing nudges |
| **Memory health score** | 0.0-1.0 (with history) | `types.ts` (ReActMemory) | Persistent score with trend tracking, LLM self-assessment |

### 9.2 Self-Healing Nudge

When the rolling health score drops below 40 and at least 3 iterations have passed since the last nudge, a message is injected into the conversation:

```
[self-check] Your last several steps haven't been making much progress
(rolling health score: 34/100 — errors and/or repeated identical actions
with no new information). Before continuing: re-read the current state
of whatever you're working on rather than assuming...
```

### 9.3 Duplicate Detection Layers

| Layer | Detection Method | Penalty |
|-------|-----------------|---------|
| **Action duplicate** | Same tool + same args + same observation | -35 |
| **Reasoning exact** | Trimmed string equality | -25 |
| **Reasoning case-insensitive** | Case-insensitive equality | -20 |
| **Reasoning fuzzy** | Levenshtein similarity ≥ 0.85 | -15 |

---

## 10. Persistence Layer

### 10.1 File-Based Persistence

| Artifact | Path | Format |
|----------|------|--------|
| Task history | `.agent/task-history.jsonl` | JSONL (one JSON object per line) |
| Task history (readable) | `.agent/task_history.md` | Markdown |
| Telemetry (thinking) | `.log/thinking.log` | Timestamp + JSON |
| Telemetry (LLM calls) | `.log/llm.log` | Timestamp + JSON |
| Telemetry (system) | `.log/sys.log` | Timestamp + JSON |
| Plan | `tasks/todo.md` | Markdown |
| Lessons | `tasks/lessons.md` | Markdown |
| Phase reports | `tasks/[task-name]-phase-[N].md` | Markdown |
| WBS | `tasks/[task-name]-wbs.md` | Markdown |

### 10.2 Database Persistence

| Store | Table | Backend |
|-------|-------|---------|
| TaskHistoryStore | `task_history` | SQLite / PostgreSQL |
| PhaseReportStore | `phase_reports` | SQLite / PostgreSQL |
| WbsStore | `wbs_entries` | SQLite / PostgreSQL |
| PlanStore | `plans`, `plan_tasks` | SQLite / PostgreSQL |
| ProjectStore | `projects` | SQLite / PostgreSQL |

Database is initialized via `npm run init-db` which runs `src/db/migrations.ts`.

---

## 11. API Server & UI

### 11.1 API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/health` | No | Health check |
| POST | `/api/v1/login` | No | Login |
| POST | `/api/v1/logout` | No | Logout |
| POST | `/api/v1/register` | No | Register first user only (fails if any user exists) |
| GET | `/api/v1/users/count` | No | User count |
| POST | `/api/v1/chat` | Yes | Execute a task |
| POST | `/api/v1/chat/plan` | Yes | Generate a plan (returns sessionId) |
| POST | `/api/v1/chat/execute` | Yes | Execute approved plan by sessionId |
| GET | `/api/v1/telemetry` | Yes | Read telemetry logs |
| GET | `/api/v1/skills` | Yes | List all skills |
| GET | `/api/v1/users` | Yes | List users |
| POST | `/api/v1/users` | Yes | Create user (admin only) |
| PUT | `/api/v1/users/:id` | Yes | Update user |
| DELETE | `/api/v1/users/:id` | Yes | Delete user |
| GET | `/api/v1/plans` | Yes | List plans |
| POST | `/api/v1/plans` | Yes | Create plan |
| GET | `/api/v1/plans/:id` | Yes | Get plan with tasks |
| PUT | `/api/v1/plans/:id/status` | Yes | Update plan status |
| PUT | `/api/v1/plans/:planId/tasks/:taskId` | Yes | Update task status within a plan |
| POST | `/api/v1/plans/:id/tasks` | Yes | Add a task to a plan |
| DELETE | `/api/v1/plans/:planId/tasks/:taskId` | Yes | Delete a task from a plan |
| GET | `/api/v1/task-history` | Yes | Read task history |
| POST | `/api/v1/task-history` | Yes | Add task history entry |
| GET | `/api/v1/task-history/:taskId/logs` | Yes | Get telemetry logs for a specific task |
| GET | `/api/v1/phase-reports` | Yes | List phase reports (requires `taskId` query param) |
| GET | `/api/v1/phase-reports/:id` | Yes | Get phase report by ID |
| GET | `/api/v1/wbs` | Yes | List WBS entries (requires `taskId` query param) |
| PUT | `/api/v1/wbs/:id/status` | Yes | Update WBS entry status |
| GET | `/api/v1/projects` | Yes | List projects |
| POST | `/api/v1/projects` | Yes | Create a project |
| PUT | `/api/v1/projects/:id` | Yes | Update a project |
| POST | `/api/v1/projects/:id/activate` | Yes | Set a project as active |
| DELETE | `/api/v1/projects/:id` | Yes | Delete a project |
| GET | `/api/v1/projects/:id/files` | Yes | Browse workspace files (optional `?path=` query) |
| DELETE | `/api/v1/projects/:id/files` | Yes | Delete a file from the workspace |
| POST | `/api/v1/projects/:id/upload` | Yes | Upload a file to the workspace (multipart) |
| GET | `/api/v1/projects/:id/download` | Yes | Download workspace as ZIP archive |
| GET | `/api/v1/settings/llm-key` | Yes | Check if API key is set (never returns the key itself) |
| PUT | `/api/v1/settings/llm-key` | Yes | Set API key |
| DELETE | `/api/v1/settings/llm-key` | Yes | Clear API key |

### 11.2 UI Pages

| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/` | Overview of recent tasks and system status |
| Chat | `/chat` | Submit tasks and view results |
| Plans | `/plans` | View, approve, and track plans |
| Plan Detail | `/pl

