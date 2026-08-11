<!-- ronin:version 1 | ronin:task task-eedb5e | ronin:updated 2026-08-11T16:15:21.604Z | ronin:subtask code-st-7639c0 -->
# xcoder — Architecture Blueprint

How xcoder works internally: design goals, core abstractions, engines, skill system, API server & UI, deployment topology, directory reference, and extension points.

## Design Goals

The architecture is organized around four goals:

1. **The orchestration engine is swappable.** The ReAct loop (`ReActOrchestrator`) is one implementation of an `IReactEngine` interface, not a hardcoded dependency of the CLI or API.
2. **Presentation is not the engine's concern.** The engine reports progress and asks for approval through an `AgentIO` interface; it has no idea whether it is talking to a terminal, an HTTP request, or a test harness.
3. **The CLI and the database are decoupled.** A `xcoder --task "..."` run never opens a database connection. Only the API server (which backs the UI) persists to the database.
4. **Behavior is extended via skills, not forks.** Domain expertise lives in `agent/skills/*/SKILL.md` and is selected at runtime by keyword routing, not compiled into the core loop.

## System Diagram

```
                         ┌──────────────────────────┐
                         │        IReactEngine        │   src/core/engine/IReactEngine.ts
                         │   (contract: run, plan,     │
                         │  selectSkills, getStatus…) │
                         └────────────┬─────────────┘
                                      │ implemented by
                         ┌────────────▼─────────────┐
                         │      ReActOrchestrator      │   src/core/orchestrator.ts
                         │  (the reference ReAct loop) │
                         └───┬───────────────────┬────┘
               reports via   │                   │  selects
                    ┌────────▼──────┐    ┌───────▼────────┐
                    │    AgentIO      │    │  SkillRegistry   │
                    │ (report/confirm)│    │ (agent/skills/*) │
                    └───┬─────────┬──┘    └─────────────────┘
                        │         │
              ┌─────────▼─┐   ┌───▼──────────┐
              │   CliIO     │   │    AutoIO      │
              │ (terminal,  │   │ (headless-safe, │
              │  readline)  │   │  never touches   │
              │             │   │  stdin; console  │
              │             │   │  logging only)   │
              └─────┬──────┘   └───────┬────────┘
                    │                   │
        ┌───────────▼──────┐  ┌────────▼─────────────┐
        │   src/cli/index.ts │  │  src/api/routes.ts     │
        │  (uses CliIO,      │  │  (uses AutoIO default, │
        │   EngineRegistry)  │  │   sets persistToDb:true)│
        └───────────┬──────┘  └────────┬─────────────┘
                    │                   │
         .log/*.log, tasks/*.md   .log/*.log, tasks/*.md,
         (file-only, always)      + database (task history,
                                    phase reports, WBS)
                                            │
                                   ┌────────▼────────┐
                                   │   ui/ (React)     │
                                   │ reads via the API  │
                                   └───────────────────┘
```

## Core Abstractions

### `IReactEngine` (`src/core/engine/IReactEngine.ts`)

The minimal contract every orchestration engine must implement: `run()`, `generatePlan()`, `selectSkills()`, plus status getters (`getLastOutcome`, `getCumulativeUsage`, `getHealthScore`, `getPartialSuccess`, `getSubagentLimitContext`). Nothing outside `src/core/engine/` should import `ReActOrchestrator` directly — go through the registry instead.

### `EngineRegistry` (`src/core/engine/EngineRegistry.ts`)

Engines are registered by name via a factory pattern:

```ts
registerEngine("react", (deps) => new ReActOrchestrator(deps.llm, deps.telemetry, { ...deps.options, io: deps.io }));
```

Selecting an engine requires only `registerEngine("your-name", factory)` — no CLI/API changes needed.

### `AgentIO` (`src/core/io/AgentIO.ts`)

`AgentIO` splits into `AgentReporter` (one-way: `log`, `thought`, `action`, `observation`, `usage`, `spinnerStart`/`spinnerStop`) and `AgentPrompter` (`confirm(message, opts)` — the only two-way call, used for plan approval and iteration-limit continuation).

Two implementations ship:

- **`CliIO`** (`src/cli/CliIO.ts`) — ANSI-colored terminal reporting, a spinner, and real `readline` prompts on stdin. This is where the "CLI functionality" lives; it is not part of the engine.
- **`AutoIO`** (`src/core/io/AutoIO.ts`) — the default. Logs to console for visibility but **never reads stdin**; `confirm()` resolves immediately with a default value. This is what makes it safe for the engine to run inside an API request handler — a headless run can never hang waiting on a prompt nobody will answer.

## Engines

All four engines implement `IReactEngine` / the V2 lifecycle interface (`cancel`, `onProgress`, `getState`, `getLastMessages`, `getWorkspacePath`, `getIterationCount`):

| Engine | Registration Name | Description |
|---|---|---|
| **ReActOrchestrator** | `react` (default) | Full-featured engine with plan mode, phase planning, subagent delegation, goal validation, and self-healing |
| **LeanEngine** | `lean` | Focused, self-contained ReAct loop — the core loop without plan mode or subagents. Supports V2 lifecycle |
| **LangGraphEngine** | `langgraph` | ReAct loop built on `@langchain/langgraph`'s StateGraph with an explicit two-node state machine (agent ↔ tools). Supports V2 lifecycle |
| **SwarmEngine** | `swarm` | Parallel swarm orchestration with WBS decomposition and concurrent agent dispatch. Supports V2 lifecycle |

Engines can also be created programmatically:

```ts
const engine = createEngine("lean", { llm, telemetry, io, options });
console.log(listEngines()); // ["react", "lean", "langgraph", "swarm"]
```

## Skill System

`SkillRegistry` (`src/core/skillRegistry.ts`) loads every `agent/skills/<name>/SKILL.md`:

```yaml
---
name: kebab-case-id       # unique
role: short-noun-phrase
description: one sentence
triggers: ["phrase one", "phrase two"]   # lowercase substrings, matched against the lowercased task
version: "1.0.0"
requires_tools: [tool_name, ...]
composes_with: [other-skill-name, ...]
---
markdown body (Process / Instructions / Strategies / Experience)
```

`route(taskDescription)` lowercases the task and counts how many triggers are literal substrings of it. **This is plain substring matching with no word boundaries** — a trigger like `"ux"` matches inside `"SELinux"`, `"pod"` matches inside `"podcast"`, and `"git"` matches inside `"digital"`. Triggers must therefore be chosen defensively (longer phrases, or explicit trailing-space boundaries like `"the pod "`).

Run `xcoder --skills` for the live list of skills with roles and triggers.

## API Server & UI

- Express server (`src/api/server.ts`) with routes mounted at `/api/v1` (`src/api/routes.ts`). Key endpoints: `/chat` (run a task), `/chat/plan` + `/chat/execute` (two-phase plan approval for the UI), `/telemetry`, `/skills`, `/task-history`, `/phase-reports`, `/wbs`, `/settings/llm-key`, plus auth (`/login`, `/logout`, `/register`, `/users`).
- Optional bearer-token auth via `XCODER_API_KEY` — if unset, the API runs unauthenticated with a startup warning.
- React UI (`ui/`) — design tokens and shared primitives (`Card`, `Button`, `Badge`, `PageHeader`) live in `ui/src/index.css` and `ui/src/components/ui/`. Pages consume the API directly; there is no server-rendering layer.

## Deployment Topology

`xcoder --deploy --docker [--remote <ip>] [--llm true|false]`:

- **No `--remote`:** local `docker compose up -d --build` — directly or, with `--llm true`, handed to the engine as a devops task so it can diagnose and fix a failed build.
- **`--remote <ip>`:** SSHes to the remote host (`REMOTE_SSH_USER`/`REMOTE_SSH_PASSWORD` from `.env`) and deploys there instead; `--remote-path` defaults to `/opt/xcoder`.

## Directory Reference

```
src/
  core/          ReAct engine, engine/IO abstractions, scoring, skill registry, protocol/plan mode
  cli/           CLI entrypoint, CliIO (terminal presentation)
  api/           Express server, routes, DB-backed stores (task history / phase reports / WBS)
  db/            Database connection, migrations, init
  tools/         Tool schemas + dispatcher
  llm/           LLM client(s) — DeepSeek primary, Anthropic fallback
  telemetry/     FileTelemetry (always-on) + Postgres telemetry (API-only)
  config/        Env/config loading
  indexing/      Workspace indexing for .agent/index/
  remote/        Remote SSH deploy support
agent/
  skills/        SKILL.md files — see Skill System
  config/        LLM provider config (llm.yaml)
ui/
  src/           React app (pages, components/ui primitives, context, API client)
tasks/           Runtime output: todo.md, wbs.md, lessons.md, phase reports (git-ignored in practice)
.log/            Runtime output: FileTelemetry logs (git-ignored in practice)
```

## Extension Points

- **New engine** — implement `IReactEngine`, then `registerEngine("name", factory)`; see `EngineRegistry.ts`'s own registration of `"react"` as the template.
- **New skill** — add `agent/skills/<name>/SKILL.md`; see the `skill-authoring` skill for the schema and trigger-safety rules.
- **New tool** — add a schema entry in `toolSchemas.ts` and a case in `toolDispatcher.ts`.
- **New IO backend** (for example a future TUI or a WebSocket-streaming API mode) — implement `AgentIO`.

## Next Steps

- [readme.md](./readme.md) — overview and quick start
- [setup.md](./setup.md) — installation and environment configuration
- [usage.md](./usage.md) — CLI reference, engine selection, and testing
