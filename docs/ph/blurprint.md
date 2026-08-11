<!-- ronin:version 1 | ronin:task task-eedb5e | ronin:updated 2026-08-11T16:16:31.954Z | ronin:subtask code-st-7639c0 -->
# xcoder — Architecture Blueprint

Ipinapaliwanag ng dokumentong ito kung paano gumagana ang xcoder sa loob: design goals, mga pangunahing abstraksyon, engines, skill system, API server at UI, deployment topology, directory reference, at extension points.

## Mga Design Goals

Ang arkitektura ay nakaayos sa paligid ng apat na layunin:

1. **Ang orchestration engine ay swappable.** Ang ReAct loop (`ReActOrchestrator`) ay isang implementation lamang ng `IReactEngine` interface, hindi isang hardcoded dependency ng CLI o API.
2. **Ang presentation ay hindi concern ng engine.** Nag-uulat ang engine ng progress at humihingi ng approval sa pamamagitan ng `AgentIO` interface; hindi nito alam kung ito ay nakikipag-usap sa isang terminal, isang HTTP request, o isang test harness.
3. **Ang CLI at ang database ay decoupled.** Ang isang `xcoder --task "..."` run ay hindi kailanman nagbubukas ng database connection. Tanging ang API server (na sumusuporta sa UI) ang nagpe-persist sa database.
4. **Ang behavior ay pinapalawak sa pamamagitan ng skills, hindi forks.** Ang domain expertise ay nasa `agent/skills/*/SKILL.md` at pinipili sa runtime sa pamamagitan ng keyword routing, hindi naka-compile sa core loop.

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

## Mga Pangunahing Abstraksyon

### `IReactEngine` (`src/core/engine/IReactEngine.ts`)

Ito ang minimal na contract na dapat ipatupad ng bawat orchestration engine: `run()`, `generatePlan()`, `selectSkills()`, kasama ang mga status getters (`getLastOutcome`, `getCumulativeUsage`, `getHealthScore`, `getPartialSuccess`, `getSubagentLimitContext`). Walang anumang code sa labas ng `src/core/engine/` ang dapat direktang mag-import ng `ReActOrchestrator` — dumaan sa registry sa halip.

### `EngineRegistry` (`src/core/engine/EngineRegistry.ts`)

Ang mga engine ay nirerehistro ayon sa pangalan sa pamamagitan ng factory pattern:

```ts
registerEngine("react", (deps) => new ReActOrchestrator(deps.llm, deps.telemetry, { ...deps.options, io: deps.io }));
```

Ang pagpili ng engine ay nangangailangan lamang ng `registerEngine("your-name", factory)` — walang pagbabagong kailangan sa CLI o API.

### `AgentIO` (`src/core/io/AgentIO.ts`)

Ang `AgentIO` ay nahahati sa `AgentReporter` (one-way: `log`, `thought`, `action`, `observation`, `usage`, `spinnerStart`/`spinnerStop`) at `AgentPrompter` (`confirm(message, opts)` — ang tanging two-way call, ginagamit para sa plan approval at iteration-limit continuation).

May dalawang implementation na kasama:

- **`CliIO`** (`src/cli/CliIO.ts`) — ANSI-colored terminal reporting, isang spinner, at tunay na `readline` prompts sa stdin. Dito nakatira ang "CLI functionality"; wala ito sa engine.
- **`AutoIO`** (`src/core/io/AutoIO.ts`) — ang default. Nagla-log sa console para makita, ngunit **hindi kailanman nagbabasa ng stdin**; ang `confirm()` ay agad na nagre-resolve gamit ang isang default value. Ito ang dahilan kung bakit ligtas ang engine na tumakbo sa loob ng API request handler — ang isang headless run ay hindi kailanman magha-hang naghihintay sa isang prompt na walang sasagot.

## Engines

Lahat ng apat na engine ay nagpapatupad ng `IReactEngine` / ng V2 lifecycle interface (`cancel`, `onProgress`, `getState`, `getLastMessages`, `getWorkspacePath`, `getIterationCount`):

| Engine | Registration Name | Paglalarawan |
|---|---|---|
| **ReActOrchestrator** | `react` (default) | Full-featured engine na may plan mode, phase planning, subagent delegation, goal validation, at self-healing |
| **LeanEngine** | `lean` | Nakatutok at self-contained ReAct loop — ang core loop nang walang plan mode o subagents. Sinusuportahan ang V2 lifecycle |
| **LangGraphEngine** | `langgraph` | ReAct loop na binuo sa `@langchain/langgraph`'s StateGraph na may explicit two-node state machine (agent ↔ tools). Sinusuportahan ang V2 lifecycle |
| **SwarmEngine** | `swarm` | Parallel swarm orchestration na may WBS decomposition at concurrent agent dispatch. Sinusuportahan ang V2 lifecycle |

Ang mga engine ay maaari ding likhain nang programmatically:

```ts
const engine = createEngine("lean", { llm, telemetry, io, options });
console.log(listEngines()); // ["react", "lean", "langgraph", "swarm"]
```

## Skill System

Ang `SkillRegistry` (`src/core/skillRegistry.ts`) ay naglo-load ng bawat `agent/skills/<name>/SKILL.md`:

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

Ang `route(taskDescription)` ay naglo-lowercase ng task at binibilang kung ilang triggers ang literal na substrings nito. **Ito ay plain substring matching na walang word boundaries** — ang isang trigger na tulad ng `"ux"` ay tutugma sa loob ng `"SELinux"`, ang `"pod"` ay tutugma sa loob ng `"podcast"`, at ang `"git"` ay tutugma sa loob ng `"digital"`. Kaya ang mga trigger ay dapat piliin nang depensibo (mas mahahabang phrases, o explicit trailing-space boundaries tulad ng `"the pod "`).

Patakbuhin ang `xcoder --skills` para sa live na listahan ng mga skills kasama ang kanilang mga roles at triggers.

## API Server at UI

- Express server (`src/api/server.ts`) na may mga route na naka-mount sa `/api/v1` (`src/api/routes.ts`). Mga pangunahing endpoints: `/chat` (magpatakbo ng task), `/chat/plan` + `/chat/execute` (two-phase plan approval para sa UI), `/telemetry`, `/skills`, `/task-history`, `/phase-reports`, `/wbs`, `/settings/llm-key`, kasama ang auth (`/login`, `/logout`, `/register`, `/users`).
- Opsyonal ang bearer-token auth sa pamamagitan ng `XCODER_API_KEY` — kung hindi naka-set, ang API ay tatakbo nang walang authentication na may startup warning.
- React UI (`ui/`) — ang design tokens at shared primitives (`Card`, `Button`, `Badge`, `PageHeader`) ay nasa `ui/src/index.css` at `ui/src/components/ui/`. Ang mga page ay direktang kumokonsumo ng API; walang server-rendering layer.

## Deployment Topology

`xcoder --deploy --docker [--remote <ip>] [--llm true|false]`:

- **Walang `--remote`:** lokal na `docker compose up -d --build` — direkta o, kung may `--llm true`, ibibigay sa engine bilang devops task para ma-diagnose at maayos ang isang failed build.
- **May `--remote <ip>`:** mag-SSH sa remote host (`REMOTE_SSH_USER`/`REMOTE_SSH_PASSWORD` mula sa `.env`) at doon mag-deploy; ang default ng `--remote-path` ay `/opt/xcoder`.

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
  skills/        SKILL.md files — tingnan ang Skill System
  config/        LLM provider config (llm.yaml)
ui/
  src/           React app (pages, components/ui primitives, context, API client)
tasks/           Runtime output: todo.md, wbs.md, lessons.md, phase reports (git-ignored in practice)
.log/            Runtime output: FileTelemetry logs (git-ignored in practice)
```

## Mga Extension Points

- **Bagong engine** — ipatupad ang `IReactEngine`, pagkatapos ay `registerEngine("name", factory)`; tingnan ang sariling registration ng `"react"` sa `EngineRegistry.ts` bilang template.
- **Bagong skill** — magdagdag ng `agent/skills/<name>/SKILL.md`; tingnan ang `skill-authoring` skill para sa schema at sa mga trigger-safety rules.
- **Bagong tool** — magdagdag ng schema entry sa `toolSchemas.ts` at isang case sa `toolDispatcher.ts`.
- **Bagong IO backend** (halimbawa, isang future TUI o WebSocket-streaming API mode) — ipatupad ang `AgentIO`.

## Mga Susunod na Hakbang

- [readme.md](./readme.md) — pangkalahatang-ideya at mabilisang pagsisimula
- [setup.md](./setup.md) — pag-install at configuration ng environment
- [usage.md](./usage.md) — CLI reference, pagpili ng engine, at pagte-test
