# xcoder — architecture blueprint

This is the "how does it work" doc. For "how do I run it," see [README.md](./README.md).

## Design goals

1. **The orchestration engine is swappable.** The ReAct loop (`ReActOrchestrator`) is one
   implementation of an `IReactEngine` interface, not a hardcoded dependency of the CLI or API.
2. **Presentation is not the engine's concern.** The engine reports progress and asks for
   approval through an `AgentIO` interface; it has no idea whether it's talking to a terminal, an
   HTTP request, or a test harness.
3. **The CLI and the database are decoupled.** A `xcoder --task "..."` run never opens a database
   connection. Only the API server (which backs the UI) persists to the database.
4. **Behavior is extended via skills, not forks.** Domain expertise (DevOps tooling, design
   heuristics, planning discipline) lives in `agent/skills/*/SKILL.md` and is selected at runtime
   by keyword routing, not compiled into the core loop.

## System diagram

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

## Core abstractions

### `IReactEngine` (`src/core/engine/IReactEngine.ts`)

The minimal contract any orchestration engine must implement: `run()`, `generatePlan()`,
`selectSkills()`, plus status getters (`getLastOutcome`, `getCumulativeUsage`, `getHealthScore`,
`getPartialSuccess`, `getSubagentLimitContext`). Nothing outside `src/core/engine/` should import
`ReActOrchestrator` directly — go through the registry instead.

### `EngineRegistry` (`src/core/engine/EngineRegistry.ts`)

```ts
registerEngine("react", (deps) => new ReActOrchestrator(deps.llm, deps.telemetry, { ...deps.options, io: deps.io }));

const engine = createEngine("react", { llm, telemetry, io, options });
```

Both the CLI (`--engine <name>`, defaults to `"react"`) and the API resolve their engine this way.
To add a second engine implementation, write a class satisfying `IReactEngine` and call
`registerEngine("your-name", factory)` — no CLI/API changes needed.

### `AgentIO` (`src/core/io/AgentIO.ts`)

Splits into `AgentReporter` (one-way: `log`, `thought`, `action`, `observation`, `usage`,
`spinnerStart`/`spinnerStop`, …) and `AgentPrompter` (`confirm(message, opts)` — the only
two-way call, used for plan approval and iteration-limit continuation).

Two implementations ship:

- **`CliIO`** (`src/cli/CliIO.ts`) — ANSI-colored terminal reporting, a spinner, and real
  `readline` prompts on stdin. This is the "CLI functionality" — it lives in `src/cli/`, not in
  the engine.
- **`AutoIO`** (`src/core/io/AutoIO.ts`) — the default. Logs to console for visibility but
  **never reads stdin**; `confirm()` resolves immediately using a default value. This is what
  makes it safe for the engine to run inside an API request handler — there is no path by which a
  headless run can hang waiting on a prompt nobody will answer.

## The ReAct loop & scoring model

Every completed tool step is scored 0–100 by `scoreStep` (`src/core/stepScorer.ts`):

- Baseline **70**.
- No error: **+10**. Error: **−45**.
- Exact duplicate action (same tool + same args + same resulting observation as an earlier step):
  **−35**. This does *not* fire on a legitimate re-run where something changed in between.
- A successful `write_edit_tool` or `run_command_tool` call: **+10** bonus (concrete forward
  progress vs. read-only investigation).

`rollingHealth()` averages the last 5 scored steps. If that average drops below **40** (with at
least 2 scores and a cooldown since the last warning), the orchestrator injects a self-check
message telling itself to re-read state, verify its last assumption, and try a different approach
— see `orchestrator.ts` around the `avgHealth < 40` check.

**Plan Mode & phases**: for non-trivial tasks, the engine drafts a plan (written to
`tasks/todo.md`) and, when phase-worthy, a phase breakdown (`tasks/wbs.md`) before executing —
each phase runs as an isolated sub-`ReActOrchestrator` with its own health tracking and iteration
budget, so a bad early assumption doesn't poison a later phase's context. Approval for both plan
and phase-plan goes through `AgentIO.confirm()`.

See the `task-planning` skill (`agent/skills/task-planning/SKILL.md`) for the agent-facing version
of this same information, written as operating instructions rather than a spec.

## Skill system

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

`route(taskDescription)` lowercases the task and counts, per skill, how many triggers are literal
substrings of it. **This is plain substring matching with no word boundaries** — a real
consequence discovered while writing these skills: a trigger like `"ux"` matches inside
`"SELinux"`, `"pod"` matches inside `"podcast"`, `"git"` matches inside `"digital"`. Triggers must
be chosen defensively (longer phrases, or explicit trailing-space boundaries like `"the pod "`)
rather than assumed safe because they look domain-specific. See the `skill-authoring` skill for
the full authoring checklist, and `CHANGES.md` for the specific collisions found and fixed across
the current skill set.

Sixteen skills currently ship: `skill-authoring`, `ui-ux-design`, `task-planning`,
`software-engineer`, `software-architect`, `qa-engineer`, and the DevOps set — `docker`,
`kubernetes`, `git-vcs`, `kafka`, `aws`, `azure`, `ubuntu`, `redhat`, `rosa`, `openshift`. Run
`xcoder --skills` for the live list with roles and triggers.

## Persistence boundary

`OrchestratorOptions.persistToDb` (default `false`) gates every database write inside the engine
(`TaskHistoryStore`, `PhaseReportStore`, `WbsStore` — all in `src/api/*Store.ts`, each backed by
SQLite or Postgres per `DATABASE_TYPE`). File-based logging (`FileTelemetry` under `.log/`, plus
`tasks/*.md`) is unconditional and always happens regardless of this flag.

- `src/cli/index.ts` never sets `persistToDb` → CLI runs are file-only.
- `src/api/routes.ts` always passes `persistToDb: true` when constructing the engine → the data
  the UI reads (task history, phase reports, WBS) only comes from API-driven runs.

Sub-orchestrators (phases, subagents) inherit `persistToDb` because every spawn site spreads
`...this.opts` into the child's options — no separate wiring needed per call site.

This wasn't always true: earlier, all four DB-writing call sites constructed their stores with no
arguments, which defaults to opening a database connection regardless of caller — meaning CLI runs
were silently touching the database. Fixed by adding the gate described above; see `CHANGES.md`
for how this was found and verified (confirmed no `.db` file appears after a CLI run, confirmed
`persistToDb` never appears in `src/cli/index.ts`).

## Tool catalog

Tools are defined in `src/tools/toolSchemas.ts` and dispatched via
`src/tools/toolDispatcher.ts`. Categories: filesystem (`read_tool`, `write_edit_tool`, `glob_tool`,
`grep_tool`), execution (`run_command_tool`, `ssh_tool`, `ssh_copy_tool`), planning
(`add_plan_task_tool`, `update_task_status_tool`, `delete_plan_task_tool`, `save_plan_tool`),
deployment (`docker_compose_deploy_tool`, `docker_deploy_ssh_tool`), web/testing
(`api_test_tool`, `playwright_run_tool`, `crawl_and_generate_playwright_test_tool`,
`crawl_site_mapper_tool`, `summarize_url_tool`), source control (`github_tool`), and a few
special-purpose tools (`subagent_tool` for isolated sub-tasks, `indexing_tool`,
`task_history_tool`, `schedule_task_tool`, `conversation_tool`).

## API server & UI

- Express server (`src/api/server.ts`), routes mounted at `/api/v1` (`src/api/routes.ts`).
  Key endpoints: `/chat` (run a task), `/chat/plan` + `/chat/execute` (two-phase plan approval for
  the UI, since the API always auto-approves plan mode internally — see the `interactive: false`
  path in `orchestrator.ts`), `/telemetry`, `/skills`, `/task-history`, `/phase-reports`, `/wbs`,
  `/settings/llm-key`, plus auth (`/login`, `/logout`, `/register`, `/users`).
- Optional bearer-token auth via `XCODER_API_KEY` — if unset, the API runs unauthenticated with a
  startup warning.
- React UI (`ui/`) — design tokens and shared primitives (`Card`, `Button`, `Badge`,
  `PageHeader`) live in `ui/src/index.css` and `ui/src/components/ui/`. Pages consume the API
  directly; there is no server-rendering layer.

## Deployment topology

`xcoder --deploy --docker [--remote <ip>] [--llm true|false]`:

- No `--remote`: local `docker compose up -d --build` (direct, via `dockerComposeUp`) or, with
  `--llm true`, the same goal handed to the engine as a devops task so it can diagnose and fix a
  failed build.
- `--remote <ip>`: SSHes to the remote host (`REMOTE_SSH_USER`/`REMOTE_SSH_PASSWORD` from `.env`)
  and deploys there instead — direct (`deployWorkspaceViaSsh`) or LLM-mediated, same `--llm` toggle.
- `remote-path` defaults to `/opt/xcoder`.

This repo does not currently ship a `docker-compose.yml`/`Dockerfile` — add ones matching your
actual services before relying on this flow (see README § Known gaps).

## Extension points

- **New engine**: implement `IReactEngine`, call `registerEngine("name", factory)` — see
  `EngineRegistry.ts`'s own registration of `"react"` as the template.
- **New skill**: add `agent/skills/<name>/SKILL.md` — see the `skill-authoring` skill for the
  schema and the trigger-safety rules learned the hard way (above).
- **New tool**: add a schema entry in `toolSchemas.ts` and a case in `toolDispatcher.ts`.
- **New IO backend** (e.g. a future TUI or a WebSocket-streaming API mode): implement `AgentIO`.

## Directory reference

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
  skills/        SKILL.md files — see § Skill system
  config/        LLM provider config (llm.yaml)
ui/
  src/           React app (pages, components/ui primitives, context, API client)
tasks/           Runtime output: todo.md, wbs.md, lessons.md, phase reports (git-ignored in practice)
.log/            Runtime output: FileTelemetry logs (git-ignored in practice)
```

## Known gaps / tech debt

Tracked here rather than silently worked around — see `CHANGES.md` for the fuller history:

- `package.json` references `scripts/*.sh` (install/setup/build/package/init-db) that don't exist
  in this checkout. Manual commands in the README work; the scripts themselves need writing.
- No `docker-compose.yml`/`Dockerfile` ships in this repo, despite `--deploy --docker` and
  `docker_compose_deploy_tool` assuming one exists at the project root.
- No `LICENSE` file.
- `.env.example`'s inline comment for `MAX_ITERATIONS` says the default is 10; the actual code
  default (`orchestrator.ts`) is 20. Minor doc drift, not a functional bug — worth fixing the
  comment to match the code, or vice versa, so they stop disagreeing.
- The original production review (`devnull-production-review.md`, pre-rebrand) flagged several
  functional/security issues beyond the scope of work done so far (SQLite handling, auth
  hardening) — not yet addressed.
