<!-- ronin:version 5 | ronin:task task-b5feec | ronin:updated 2026-08-13T08:18:21.304Z | ronin:subtask code-st-82c66c -->
# Likha CLI Tools

**likha** — isang ReAct CLI agent na may hot-pluggable role skills, DeepSeek bilang default.

- **Bersyon:** 0.2.0
- **Lisensya:** MIT
- **Engine:** TypeScript (Node.js), ReAct loop na may maraming engine implementation
- **LLM:** DeepSeek (default), may mock client para sa testing

---

## Talaan ng Nilalaman

- [Pangkalahatang-ideya](#pangkalahatang-ideya)
- [Mabilisang Simula](#mabilisang-simula)
- [Paggamit ng CLI](#paggamit-ng-cli)
- [Arkitektura](#arkitektura)
- [Mga Engine](#mga-engine)
- [Skill System](#skill-system)
- [Plan Mode](#plan-mode)
- [Phase Planning](#phase-planning)
- [Self-Healing at Duplicate Detection](#self-healing-at-duplicate-detection)
- [Goal Validation](#goal-validation)
- [Context Compaction](#context-compaction)
- [API Server](#api-server)
- [UI](#ui)
- [Deploy Mode](#deploy-mode)
- [Audit at Diagnostics](#audit-at-diagnostics)
- [Configuration](#configuration)
- [Database Layer](#database-layer)
- [Development](#development)
- [Project Structure](#project-structure)

---

## Pangkalahatang-ideya

Ang likha ay isang CLI agent na sumusunod sa pattern na **ReAct** (Reasoning + Acting): paulit-ulit itong nag-iisip tungkol sa isang task, tumatawag ng mga tool para mangalap ng impormasyon o gumawa ng pagbabago, obserbahan ang mga resulta, at uulitin hanggang matapos ang task. Suportado nito ang maraming orchestration engine, hot-pluggable skill directives, phase planning, isang HTTP API server, isang React UI, at isang built-in self-healing mechanism na nakakatukoy kapag na-stuck ang agent.

### Mga Pangunahing Feature

- **ReAct loop** na may Search → Action → Validation phases
- **Maraming engine implementation** — standard ReAct, LeanEngine, LangGraph, Swarm
- **Hot-pluggable skill system** — 30+ specialized skills (programmer, architect, devops, tester, atbp.) na naka-load mula sa `agent/skills/`
- **Plan Mode** — gumagawa ng task plan bago mag-execute, may pag-apruba ng user
- **Phase Planning** — hinahati ang mga kumplikadong task sa sunud-sunod na phases na may isolated context
- **Duplicate action detection** — pinipigilan ang mga sayang na paulit-ulit na tool call
- **Duplicate iteration reason detection** — three-pass matching (exact, case-insensitive, fuzzy) para sa paulit-ulit na reasoning
- **Self-healing health scoring** — nakakatukoy ng na-stall na progreso at nagbibigay ng nudge sa agent
- **Goal validation** — independent na pag-verify bago tanggapin ang completion
- **Context compaction** — kina-collapse ang mga lumang file reads para makatipid ng tokens (lean-token mode)
- **Subagent delegation** — inilipat ang trabaho sa mga isolated sub-agent
- **Persistent task history** — file-based (`.agent/task-history.jsonl` + `.agent/task_history.md`) at database-backed (SQLite/Postgres)
- **HTTP API server** — Express-based REST API para sa remote task execution
- **React UI** — Vite + TypeScript frontend para sa pamamahala ng tasks, plans, at telemetry
- **Deploy mode** — local Docker Compose o remote SSH deployment
- **ReAct audit** — automated bug-fixing scenario battery
- **Live diagnostics** — 7-point ReAct diagnostic suite

---

## Mabilisang Simula

```bash
# I-install ang mga dependency
npm run likha:install

# Build
npm run build

# Magpatakbo ng task
npm start -- --task "List all TypeScript files in src/"

# O gamitin ang dev mode (hindi kailangan ng build)
npm run dev -- --task "List all TypeScript files in src/"
```

### Mga Kinakailangan (Prerequisites)

- **Node.js** >= 18
- **DeepSeek API key** — i-set ang `DEEPSEEK_API_KEY` sa iyong environment o `.env` file
- **npm** (para sa UI dependencies)

### Environment Variables

Gumawa ng `.env` file sa project root:

```env
DEEPSEEK_API_KEY=sk-your-key-here
# Optional:
# MAX_ITERATIONS=30
# XCODER_API_PORT=3001
# XCODER_API_HOST=0.0.0.0
# DATABASE_URL=postgresql://user:pass@localhost:5432/likha
# REMOTE_SSH_USER=deploy
# REMOTE_SSH_PASSWORD=your-password
# XCODER_SSH_TARGETS=host1:22,host2:22
# XCODER_SSH_USER=fleet-user
# XCODER_SSH_PASSWORD=fleet-password
```

---

## Paggamit ng CLI

```bash
likha [task] [options]
```

### Mga Argumento

| Argumento | Paglalarawan |
|----------|-------------|
| `[task]` | Deskripsyon ng task — katumbas ng `--task <description>` |

### Mga Option

| Option | Paglalarawan |
|--------|-------------|
| `--task <description>` | Mag-execute ng isang task, magtatanong ng paglilinaw kung kinakailangan |
| `--chat` | Pumasok sa interactive chat mode (workspace = kasalukuyang folder) |
| `--index` | I-index ang kasalukuyang workspace sa `.agent/index/` |
| `--skills` | Ilista ang lahat ng naka-load na skills at ang kanilang trigger keywords |
| `--lesson <text>` | Mag-record ng lesson sa `tasks/lessons.md` (tingnan ang likha.md Self-Improvement Loop) |
| `--plan` | Sapilitang i-on ang Plan Mode, anuman ang task complexity heuristic |
| `--no-plan` | Sapilitang i-off ang Plan Mode, anuman ang task complexity heuristic |
| `--full-context-token` | Panatilihin ang bawat historical copy ng read_tool file snapshots sa context sa halip na i-collapse ang mga luma; default: naka-off, naka-on ang lean-token compaction |
| `--single-phase` | I-disable ang phase-based planning at magpatakbo bilang isang solong ReAct loop; default: naka-ON ang phase-planning |
| `--auto` | Fully autonomous mode — awtomatikong sinasagot ng 'yes' ang LAHAT ng interactive prompts (plan approval, phase plan approval, iteration limit continuation, subagent continuation). Buong dinadala ng LLM mula simula hanggang katapusan nang walang human intervention. Gamitin ito para sa CI/CD, automated testing, o anumang scenario na kailangan ng zero human input. |
| `--isolated-workspace` | Magpatakbo ng tool operations laban sa isang isolated `./workspace-agent` copy sa halip na sa live project files (tingnan ang `src/core/workspaceManager.ts`); default: naka-off |
| `--engine <name>` | Orchestration engine na gagamitin (default: `react`). Mga rehistradong engine: `react`, `lean`, `langgraph`, `swarm`. Tingnan ang `src/core/engine/EngineRegistry.ts` para mag-rehistro ng ibang implementation. |
| `--serve` | Simulan ang likha HTTP API server |
| `--ui` | Simulan ang likha HTTP API server at ang UI frontend |
| `--port <number>` | Port para sa API server (default: 3001) |
| `--host <address>` | Host para sa API server (default: 0.0.0.0) |
| `--deploy` | I-trigger ang deploy mode (Docker Compose) |
| `--docker` | Gamitin ang Docker Compose para sa deployment |
| `--llm <boolean>` | Ipadala ang deploy task sa LLM bilang isang devops task |
| `--remote <ip>` | Remote host IP na pagde-deploy-han |
| `--remote-path <path>` | Remote directory path para sa deployment (default: `/opt/likha`) |
| `--audit-react` | Patakbuhin ang built-in bug-fixing scenario battery sa pamamagitan ng tunay na orchestrator at mag-ulat kung paano ito nag-perform |
| `--audit-out <path>` | Kung saan isusulat ang audit report markdown (default: `reports/react-audit-<timestamp>.md`) |
| `--diagnose-live` | Patakbuhin ang 7-point ReAct diagnostic suite laban sa tunay na na-configure na LLM: iteration stopping, restart-approval, duplicate-action avoidance, tool/skill usage, ground-up deployable app, bug fixing, at full SDLC |
| `--diagnose-out <path>` | Kung saan isusulat ang diagnostics report |

### Mga Halimbawa

```bash
# Magpatakbo ng isang task
likha "Refactor the authentication module to use JWT tokens"

# Interactive chat mode
likha --chat

# Ilista ang mga available na skills
likha --skills

# I-index ang workspace
likha --index

# Mag-record ng lesson
likha --lesson "Always validate file paths before writing"

# Gamitin ang LangGraph engine
likha --engine langgraph --task "Analyze the test coverage"

# Simulan ang API server
likha --serve --port 3001

# Simulan ang API + UI
likha --ui

# Mag-deploy gamit ang Docker Compose
likha --deploy --docker

# Mag-deploy sa isang remote host
likha --deploy --docker --remote 192.168.1.100

# Magpatakbo sa fully autonomous mode
likha --auto --task "Set up CI/CD pipeline"

# Patakbuhin ang ReAct audit
likha --audit-react

# Patakbuhin ang live diagnostics
likha --diagnose-live
```

---

## Arkitektura

```
likha/
├── agent/                  # Mga skill definition at protocol files
│   ├── likha.md           # Engineering protocol (system prompt)
│   └── skills/             # 30+ skill definitions (SKILL.md bawat skill)
├── src/
│   ├── cli/                # CLI entry point (Commander)
│   │   ├── index.ts        # CLI argument parsing at dispatch
│   │   └── CliIO.ts        # Terminal I/O (spinner, prompts, colors)
│   ├── api/                # Express API server
│   │   ├── server.ts       # Server startup
│   │   ├── routes.ts       # Lahat ng API endpoints
│   │   ├── auth.ts         # Token-based authentication
│   │   ├── types.ts        # API request/response types
│   │   ├── projectRoutes.ts
│   │   ├── planRoutes.ts
│   │   ├── projectStore.ts
│   │   ├── planStore.ts
│   │   ├── wbsStore.ts
│   │   ├── phaseReportStore.ts
│   │   ├── taskHistoryStore.ts
│   │   └── llmKeyStore.ts
│   ├── core/               # Core orchestration logic
│   │   ├── engine/         # Mga engine implementation
│   │   │   ├── IReactEngine.ts       # Engine interface + V2 lifecycle
│   │   │   ├── EngineRegistry.ts     # Factory pattern para sa paggawa ng engine
│   │   │   ├── LeanEngine.ts         # Focused ReAct loop
│   │   │   ├── LangGraphEngine.ts    # LangGraph StateGraph-based loop
│   │   │   └── SwarmEngine.ts        # Parallel swarm orchestration
│   │   ├── io/             # I/O abstractions
│   │   │   ├── AgentIO.ts  # Abstract I/O interface
│   │   │   └── AutoIO.ts   # Headless-safe I/O (walang stdin)
│   │   ├── orchestrator.ts # Full-featured ReAct orchestrator
│   │   ├── types.ts        # Core types (LlmMessage, ReActStep, atbp.)
│   │   ├── protocol.ts     # Protocol prompt builder
│   │   ├── skillRegistry.ts # Skill loading at routing
│   │   ├── stepScorer.ts   # Health scoring bawat step
│   │   ├── duplicateActionDetector.ts # Duplicate tool call detection
│   │   ├── iterationReasonDedup.ts    # Duplicate reasoning detection
│   │   ├── contextCompaction.ts       # Stale file read compaction
│   │   ├── goalValidator.ts           # Independent completion validation
│   │   ├── workspaceManager.ts        # Isolated workspace management
│   │   ├── taskHistory.ts             # File-based task history
│   │   ├── reactAuditor.ts            # Bug-fixing scenario battery
│   │   └── liveDiagnostics.ts         # 7-point diagnostic suite
│   ├── tools/              # Tool implementations (20+ tools)
│   │   ├── toolSchemas.ts  # Tool definitions para sa LLM function calling
│   │   ├── toolDispatcher.ts # Tool call dispatch
│   │   └── *.ts            # Individual tool implementations
│   ├── llm/                # LLM client integrations
│   │   ├── deepseekClient.ts # DeepSeek API client
│   │   └── mockClient.ts   # Mock client para sa testing
│   ├── config/             # Configuration loading
│   │   └── loadConfig.ts   # LLM config mula sa env/file
│   ├── db/                 # Database layer
│   │   ├── sqliteClient.ts # SQLite client
│   │   ├── postgresClient.ts # PostgreSQL client
│   │   ├── migrations.ts   # Schema migrations
│   │   └── connection.ts   # Connection management
│   ├── indexing/           # Workspace indexing
│   │   ├── indexer.ts      # File indexer
│   │   └── workspaceInfo.ts # Workspace snapshot
│   ├── remote/             # SSH/SCP remote operations
│   │   ├── sshConnection.ts
│   │   └── scpUpload.ts
│   └── telemetry/          # Logging at telemetry
│       ├── logger.ts       # File-based telemetry
│       └── postgresTelemetry.ts # DB-backed telemetry
├── ui/                     # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── pages/          # Page components
│   │   ├── components/     # Shared UI components
│   │   └── App.tsx         # Root app na may routing
│   └── package.json
├── tasks/                  # Ginawang task artifacts
│   ├── todo.md             # Kasalukuyang plano
│   ├── lessons.md          # Naitalang mga lesson
│   └── *.md                # Phase reports at WBS files
└── .agent/                 # Agent metadata
    ├── index/              # Workspace index
    └── task-history.*      # Task history files
```

---

## Mga Engine

Nagbibigay ang likha ng apat na engine implementation, lahat ay maaaring magpalitan sa isa't isa sa pamamagitan ng `IReactEngine` interface. Pumili ng isa gamit ang `--engine` flag o sa pamamagitan ng `EngineRegistry.createEngine()`.

| Engine | Flag | Paglalarawan |
|--------|------|-------------|
| **ReActOrchestrator** | `react` (default) | Full-featured engine na may plan mode, phase planning, subagent delegation, goal validation, at self-healing |
| **LeanEngine** | `lean` | Focused, self-contained ReAct loop — ang core loop na walang plan mode o subagents. Sumusuporta sa V2 lifecycle (cancellation, progress observers, state tracking) |
| **LangGraphEngine** | `langgraph` | ReAct loop na binuo gamit ang StateGraph ng `@langchain/langgraph` na may explicit two-node state machine (agent ↔ tools). Sumusuporta sa V2 lifecycle |
| **SwarmEngine** | `swarm` | Parallel swarm orchestration na may WBS decomposition at concurrent agent dispatch. Sumusuporta sa V2 lifecycle |

### Engine Registry

Ang mga engine ay nire-rehistro sa pamamagitan ng `EngineRegistry.ts` gamit ang factory pattern:

```typescript
import { createEngine, listEngines } from "./core/engine/EngineRegistry.js";

const engine = createEngine("lean", { llm, telemetry, io, options });
console.log(listEngines()); // ["react", "lean", "langgraph", "swarm"]
```

### IReactEngineV2 Lifecycle

Nagdaragdag ang V2 interface ng lifecycle management sa mga engine:

```typescript
interface IReactEngineV2 extends IReactEngine {
  cancel(reason?: string): void;
  onProgress(observer: ProgressObserver): () => void;
  getState(): EngineState; // "idle" | "planning" | "running" | "validating" | "cancelled" | "completed" | "error"
  getLastMessages(): LlmMessage[];
  getWorkspacePath(): string;
  getIterationCount(): number;
}
```

---

## Skill System

May hot-pluggable skill system ang likha. Ang mga skill ay tinukoy bilang markdown files na may YAML frontmatter sa `agent/skills/<name>/SKILL.md`. Ang bawat skill ay may:

- **Trigger keywords** — itinutugma laban sa task description para awtomatikong mapili ang mga relevant na skill
- **Role** — ang persona na dapat gamitin ng LLM (hal., "Software Engineer", "DevOps Engineer")
- **Process/Strategies/Instructions** — isinasama sa system prompt kapag napili ang skill
- **`composes_with`** — nagbibigay-daan sa multi-skill composition (hal., programmer + tester)

### Mga Available na Skill (30+)

analyst, architect, aws, azure, conversation, devops, docker, docker-expert, filesystem-management, git-vcs, kafka, kubernetes, kubernetes-expert, openshift, pentester, performance-tester, playwright-ui-tester, programmer, qa-engineer, rca, redhat, rosa, scrum-framework, scrum-master-agent, secops, skill-authoring, software-architect, software-engineer, task-planning, tester, ubuntu, ui-ux-design, workspace-context

### Paano Naka-load ang mga Skill

1. Sinisiyasat ng `SkillRegistry` ang `agent/skills/` para sa mga `SKILL.md` file
2. Ina-analyze ang YAML frontmatter ng bawat file para sa pangalan, role, triggers, at `composes_with`
3. Kapag na-submit ang isang task, itinutugma ng registry ang trigger keywords laban sa task description
4. Ang mga na-match na skill (at ang kanilang `composes_with` na kasama) ay isinasama sa system prompt ng LLM

```bash
# Ilista ang lahat ng skills at ang kanilang triggers
likha --skills
```

---

## Plan Mode

Gumagawa ang Plan Mode ng task plan bago mag-execute, sinusunod ang direktiba ng engineering protocol: *"Pumasok sa plan mode para sa ANUMANG hindi-trivial na task (3+ steps o architectural decisions)."*

### Paano Ito Gumagana

1. **Trigger** — nag-a-activate ang plan mode kapag:
   - naka-set ang `--plan` flag (force on)
   - `planMode: "always"` sa options
   - `planMode: "auto"` (default) at 2+ skills ang na-match (nagpapahiwatig ng cross-cutting work)
2. **Generation** — gumagawa ang LLM ng markdown checklist (3-8 steps) nang hindi tumatawag ng anumang tool
3. **Approval** — isinusulat ang plano sa `tasks/todo.md` at ipinapakita sa user para sa pag-apruba
4. **Execution** — pagkatapos ma-apruba, ise-execute ng ReAct loop ang plano
5. **Review** — pagkatapos matapos, may idinaragdag na review section sa `tasks/todo.md`

### Two-Phase API Flow

Sinusuportahan ng API ang two-phase flow para sa UI integration:

1. `POST /api/v1/chat/plan` — Gumawa ng plano, ibinabalik ang isang `sessionId`
2. `POST /api/v1/chat/execute` — I-execute ang naaprubahang plano gamit ang `sessionId`

---

## Phase Planning

Hinahati ng Phase Planning ang mga kumplikadong task sa sunud-sunod na phases, na ang bawat isa ay tumatakbo bilang isang sub-orchestrator na may isolated ReAct memory. Binabawasan nito ang token footprint bawat phase, ngunit ang kapalit ay nawawala ang cross-phase context continuity.

### Paano Ito Gumagana

1. **Decomposition** — hinahati ng LLM ang task sa 2-5 sunud-sunod na phase, bawat isa ay may sariling layunin
2. **Approval** — ipinapakita ang phase plan sa user para sa pag-apruba
3. **Execution** — bawat phase ay tumatakbo nang sunud-sunod bilang isang sub-orchestrator na may isolated ReAct memory
4. **Summarization** — pagkatapos ng bawat phase, ibinubuod ng LLM kung ano ang naisagawa para sa susunod na phase
5. **Reporting** — ang mga ulat bawat phase ay sine-save sa `tasks/[task-name]-phase-[N].md`; isang WBS file ang isinusulat sa `tasks/[task-name]-wbs.md`

### Mga Phase Artifact

- `tasks/[task-name]-wbs.md` — Work Breakdown Structure, na na-update habang natatapos ang mga phase
- `tasks/[task-name]-phase-[N].md` — Mga ulat bawat phase na may resulta at estadistika
- Color-coded na CLI output na nagpapakita ng token usage at iteration counts bawat phase

### Pag-disable sa Phase Planning

```bash
# Magpatakbo bilang isang solong ReAct loop (walang phase planning)
likha --single-phase --task "Complex task"
```

---

## Self-Healing at Duplicate Detection

May multi-layered self-healing system ang likha na nakakatukoy kapag na-stuck ang agent at ibinabalik ito sa tamang direksyon.

### Health Scoring

Dalawang parallel health score system ang sumusubaybay sa progreso ng agent:

1. **Step-level health** (`stepScorer.ts`) — Isang heuristic na 0-100 score bawat tool step, batay sa:
   - Nagka-error ba ang tool call? (-45 na parusa)
   - Ito ba ay isang duplicate action? (-35 na parusa)
   - Duplicate ba ang iteration reason? (exact: -25, case-insensitive: -20, fuzzy: -15)
   - Nagtagumpay ba ang isang write/edit/run_command? (+10 na reward)
   - Rolling average sa huling 5 steps

2. **Memory health score** (`types.ts`) — Isang 0.0-1.0 score na may history, trend, at `ScoreEntry` array:
   - LLM self-assessment (ina-analyze ang `score: X` mula sa reasoning)
   - Heuristic fallback (dinadagdagan kapag nagtagumpay, binabawasan kapag nagka-error)
   - Trend tracking ("up", "down", "stable")

Kapag bumaba sa ibaba ng 40 ang rolling health score, may isang beses na nudge na isinasama sa context na humihiling sa model na i-reconsider ang kanyang approach.

### Duplicate Action Detection

Nakakatukoy ang `duplicateActionDetector.ts` kapag inulit ng LLM ang eksaktong parehong tool call (parehong tool + parehong arguments) na nakagawa na ng parehong obserbasyon. Pinipigilan nito ang mga sayang na loop tulad ng muling pagbabasa ng parehong file o muling pagpapatakbo ng parehong command.

### Duplicate Iteration Reason Detection

Nakakatukoy ang `iterationReasonDedup.ts` kapag gumawa ang LLM ng reasoning na sa esensya ay pareho sa reasoning ng nakaraang iteration. Gumagamit ito ng three-pass matching strategy:

1. **Exact match** (trimmed string equality) — parusa: -25
2. **Case-insensitive match** — parusa: -20
3. **Fuzzy match** (Levenshtein similarity na higit sa 0.85 threshold) — parusa: -15

Isang rolling window (default: huling 5 reasons) ang pumipigil sa pag-flag ng lehitimong magkatulad na reasoning mula sa mas naunang bahagi ng mahabang task. Ang mga string na mas maikli sa 20 characters ay hindi kailanman fuzzy-matched.

> **⚠️ Status Note:** Ang `thought` parameter para sa duplicate iteration reason detection ay kasalukuyang HINDI ipinapasa ng alinman sa apat na call site (orchestrator.ts, LangGraphEngine.ts, LeanEngine.ts, SwarmEngine.ts). Dormant ang feature na ito sa production — tumatakbo lamang ito sa unit tests.

---

## Goal Validation

Bago tanggapin ang isang completion, pinapadaan muna ng likha ang resulta sa isang independent na validator (isang pangalawang LLM call) na che-check kung talagang sinusuportahan ng mga naitalang obserbasyon ang inaangking completion.

- **Naka-enable bilang default** (`validateGoal: true`)
- **Max retries:** 2 (nako-configure sa pamamagitan ng `maxValidatorRetries`)
- **Rejection feedback:** Kapag na-reject ng validator ang isang claim, ang dahilan ng pagtanggi ay ibinabalik sa context at muling susubukan ng agent
- **Exhaustion:** Pagkatapos ng max retries, tinatanggap ang huling sagot nang walang beripikasyon

---

## Context Compaction

Ang context compaction (lean-token mode) ay **naka-enable bilang default**. Kina-collapse nito ang mga lumang/na-supersede na `read_tool` observations para makatipid ng tokens.

### Ano ang Ginagawa Nito

- Kapag muling binasa o isinulat ang isang file, ang bawat **estrikto nang mas naunang** `read_tool` observation para sa parehong path ay kina-collapse sa isang maikling placeholder
- Ang pinakahuling snapshot ng anumang file ay laging nananatiling buo
- Nire-resolba rin nito ang isang correctness issue: kung walang compaction, ang mga lumang stale file snapshot ay nananatili sa context na mukhang kasing-authoritative ng kasalukuyan

### Ano ang Hindi Nito Ginagalaw

- Ang `tool_calls` at `reasoning_content` ng assistant messages — kinakailangan ng thinking-mode API ng DeepSeek na ito ay mapanatili
- Ang `tool_call_id` linkage — hindi kailanman nasisira
- Mga observation na hindi read_tool

### Pag-disable ng Compaction

```bash
# Panatilihin ang lahat ng historical file reads sa context
likha --full-context-token --task "My task"
```

---

## API Server

May kasamang Express-based HTTP API server ang likha para sa remote task execution at UI integration.

### Pagsisimula ng Server

```bash
# Simulan lamang ang API server
likha --serve --port 3001

# Simulan ang parehong API at UI
likha --ui
```

### Authentication

- **Token-based authentication** — lahat ng endpoint maliban sa `/health`, `/login`, `/register`, at `/users/count` ay nangangailangan ng Bearer token
- **First-user registration** — ang unang user na mag-rehistro ay nagiging admin; ang susunod na mga user ay dapat idagdag ng isang admin
- **Password hashing** — hina-hash ang mga password bago i-store

### Mga API Endpoint

| Method | Endpoint | Paglalarawan |
|--------|----------|-------------|
| `GET` | `/api/v1/health` | Health check (walang auth) |
| `POST` | `/api/v1/login` | Login (walang auth) |
| `POST` | `/api/v1/logout` | Logout (walang auth) |
| `POST` | `/api/v1/register` | Magrehistro lamang ng unang user (walang auth) |
| `GET` | `/api/v1/users/count` | Bilang ng user (walang auth) |
| `POST` | `/api/v1/chat` | Mag-execute ng task |
| `POST` | `/api/v1/chat/plan` | Gumawa ng plano (ibinabalik ang sessionId) |
| `POST` | `/api/v1/chat/execute` | I-execute ang isang naaprubahang plano gamit ang sessionId |
| `GET` | `/api/v1/telemetry` | Basahin ang telemetry logs |
| `GET` | `/api/v1/skills` | Ilista ang lahat ng skills |
| `GET` | `/api/v1/users` | Ilista ang mga user |
| `POST` | `/api/v1/users` | Gumawa ng user (admin lamang) |
| `PUT` | `/api/v1/users/:id` | I-update ang user |
| `DELETE` | `/api/v1/users/:id` | Burahin ang user |
| `GET` | `/api/v1/plans` | Ilista ang mga plano |
| `POST` | `/api/v1/plans` | Gumawa ng plano |
| `GET` | `/api/v1/plans/:id` | Kunin ang plano kasama ang mga task |
| `PUT` | `/api/v1/plans/:id/status` | I-update ang status ng plano |
| `PUT` | `/api/v1/plans/:planId/tasks/:taskId` | I-update ang status ng task sa loob ng isang plano |
| `POST` | `/api/v1/plans/:id/tasks` | Magdagdag ng task sa isang plano |
| `DELETE` | `/api/v1/plans/:planId/tasks/:taskId` | Burahin ang task mula sa isang plano |
| `GET` | `/api/v1/task-history` | Basahin ang task history |
| `POST` | `/api/v1/task-history` | Magdagdag ng entry sa task history |
| `GET` | `/api/v1/task-history/:taskId/logs` | Kunin ang telemetry logs para sa isang partikular na task |
| `GET` | `/api/v1/phase-reports` | Ilista ang mga phase report (nangangailangan ng `taskId` query param) |
| `GET` | `/api/v1/phase-reports/:id` | Kunin ang phase report gamit ang ID |
| `GET` | `/api/v1/wbs` | Ilista ang mga WBS entry (nangangailangan ng `taskId` query param) |
| `PUT` | `/api/v1/wbs/:id/status` | I-update ang status ng WBS entry |
| `GET` | `/api/v1/projects` | Ilista ang mga project |
| `POST` | `/api/v1/projects` | Gumawa ng project |
| `PUT` | `/api/v1/projects/:id` | I-update ang isang project |
| `POST` | `/api/v1/projects/:id/activate` | Itakda ang isang project bilang aktibo |
| `DELETE` | `/api/v1/projects/:id` | Burahin ang isang project |
| `GET` | `/api/v1/projects/:id/files` | I-browse ang mga workspace file (opsyonal na `?path=` query) |
| `DELETE` | `/api/v1/projects/:id/files` | Burahin ang isang file mula sa workspace |
| `POST` | `/api/v1/projects/:id/upload` | Mag-upload ng file sa workspace (multipart) |
| `GET` | `/api/v1/projects/:id/download` | I-download ang workspace bilang ZIP archive |
| `GET` | `/api/v1/settings/llm-key` | Suriin kung naka-set ang API key |
| `PUT` | `/api/v1/settings/llm-key` | I-set ang API key |
| `DELETE` | `/api/v1/settings/llm-key` | Burahin ang API key |

### Chat API Response

Ang `/chat` endpoint ay nagbabalik ng structured na response na kinabibilangan ng:

- `result` — Ang text ng resulta ng task
- `plan` — Ang nabuong plano (kung aktibo ang plan mode)
- `sessionId` — Para sa two-phase approval flow
- `usage` — Estadistika ng token usage
- `healthScore` — Kasalukuyang self-healing health score
- `limitation` — Paliwanag kung hindi normal na natapos ang task
- `partialSuccess` — Konteksto ng partial progress kapag naabot ang iteration limit
- `subagentContext` — Napanatiling subagent context para sa "Continue" na button

---

## UI

May kasamang React frontend ang likha na ginawa gamit ang Vite at TypeScript.

### Pagsisimula ng UI

```bash
# Simulan ang parehong API at UI
likha --ui

# O gamitin ang npm script
npm run likha:ui
```

### Mga Feature ng UI

- **Dashboard** — Pangkalahatang-ideya ng mga kamakailang task at status ng sistema
- **Chat interface** — Mag-submit ng mga task at tingnan ang mga resulta
- **Plan management** — Tingnan, aprubahan, at subaybayan ang mga plano
- **Task history** — I-browse ang mga naunang task execution
- **Phase reports** — Tingnan ang mga resulta bawat phase
- **Telemetry viewer** — I-browse ang thinking logs at LLM call logs
- **User management** — Admin panel para sa pamamahala ng user
- **Settings** — Configuration ng LLM API key
- **Project management** — Magdagdag at lumipat sa pagitan ng mga project
- **Diagnostics** — Tingnan ang health scores at system diagnostics

---

## Deploy Mode

Sinusuportahan ng likha ang local at remote deployment sa pamamagitan ng Docker Compose.

### Local Deploy

```bash
# Mag-deploy gamit ang Docker Compose (direktang execution)
likha --deploy --docker

# Mag-deploy na may LLM bilang devops engineer (nag-di-diagnose at nag-aayos ng mga isyu)
likha --deploy --docker --llm true
```

### Remote Deploy

```bash
# Mag-deploy sa isang remote host
likha --deploy --docker --remote 192.168.1.100

# May custom remote path
likha --deploy --docker --remote 192.168.1.100 --remote-path /opt/myapp

# May tulong ng LLM
likha --deploy --docker --remote 192.168.1.100 --llm true
```

Nangangailangan ng `REMOTE_SSH_USER` at `REMOTE_SSH_PASSWORD` environment variables para sa remote deployment.

### Fleet Operations

Para sa fleet operations sa maraming host, gamitin ang shared SSH credentials:

```env
XCODER_SSH_TARGETS=host1:22,host2:22
XCODER_SSH_USER=fleet-user
XCODER_SSH_PASSWORD=fleet-password
```

---

## Audit at Diagnostics

### ReAct Audit

Sinusubok ng built-in bug-fixing scenario battery ang orchestrator laban sa isang set ng predefined na bug-fixing scenario. Bawat scenario ay independiyenteng na-verify.

```bash
likha --audit-react
likha --audit-out reports/my-audit.md
```

### Live Diagnostics

Sinusubok ng 7-point ReAct diagnostic suite ang tunay na na-configure na LLM laban sa:
1. Iteration stopping
2. Restart-approval
3. Duplicate-action avoidance
4. Tool/skill usage
5. Ground-up deployable app
6. Bug fixing
7. Full SDLC

```bash
likha --diagnose-live
likha --diagnose-out reports/my-diagnostics.md
```

---

## Configuration

### OrchestratorOptions

Kinokontrol ng `OrchestratorOptions` interface (tinukoy sa `src/core/orchestrator.ts`) ang behavior ng engine:

| Option | Type | Default | Paglalarawan |
|--------|------|---------|-------------|
| `maxIterations` | `number` | `20` | Max na ReAct iterations bawat round |
| `planMode` | `"auto" \| "always" \| "never"` | `"auto"` | Trigger strategy ng plan mode |
| `validateGoal` | `boolean` | `true` | Independent validation bago mag-complete |
| `maxValidatorRetries` | `number` | `2` | Max na validator rejection retries |
| `interactive` | `boolean` | `true` | I-enable ang interactive stdin prompts |
| `auto` | `boolean` | `false` | Fully autonomous mode |
| `continueOnLimit` | `boolean` | `false` | Awtomatikong ipagpatuloy lampas sa iteration limit |
| `consoleThoughts` | `boolean` | `true` | Ipakita ang live console output |
| `leanToken` | `boolean` | `true` | I-enable ang context compaction |
| `fullContextToken` | `boolean` | `false` | I-disable ang context compaction |
| `selfHealing` | `boolean` | `true` | I-enable ang self-healing nudges |
| `isolatedWorkspace` | `boolean` | `false` | Magpatakbo sa isolated workspace copy |
| `singlePhase` | `boolean` | `false` | I-disable ang phase planning |
| `io` | `AgentIO` | `AutoIO` | I/O abstraction (CLI vs API) |
| `persistToDb` | `boolean` | `false` | I-enable ang database persistence |

### Environment Variables

```env
DEEPSEEK_API_KEY=sk-your-key-here
# ANTHROPIC_API_KEY=sk-ant-your-key-here   # fallback o provider switch (llm.yaml)
```

| Variable | Paglalarawan |
|----------|-------------|
| `DEEPSEEK_API_KEY` | DeepSeek API key (default provider — kinakailangan para sa default na pagpapatakbo) |
| `ANTHROPIC_API_KEY` | Anthropic API key (halimbawa ng fallback/provider switch; ang `api_key_env` sa `llm.yaml` ang nagpapangalan kung anong variable ang kailangan ng anumang provider) |
| `MAX_ITERATIONS` | I-override ang max iterations |
| `XCODER_API_PORT` | Port ng API server |
| `XCODER_API_HOST` | Host ng API server |
| `DATABASE_URL` | PostgreSQL connection string |
| `REMOTE_SSH_USER` | SSH user para sa remote deploy |
| `REMOTE_SSH_PASSWORD` | SSH password para sa remote deploy |
| `XCODER_SSH_TARGETS` | Fleet SSH targets |
| `XCODER_SSH_USER` | Fleet SSH user |
| `XCODER_SSH_PASSWORD` | Fleet SSH password |
| `GITHUB_TOKEN` | GitHub token para sa git operations |

> Ang legacy na `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` env vars ay **hindi binabasa** ng likha.
> Ang provider, base URL, endpoint, at model ay naka-configure sa `agent/config/llm.yaml` — tingnan sa ibaba.

### Mga LLM Provider

Ang LLM backend ng likha ay config-driven at provider-agnostic. **Default ang DeepSeek**,
ngunit anumang OpenAI-compatible na provider (OpenAI, OpenRouter, Groq, Ollama, isang company proxy, …)
at Anthropic ay maaaring piliin sa pamamagitan ng pag-edit ng `agent/config/llm.yaml` at pag-set ng
katugmang API key environment variable — **walang kailangang baguhin sa code o CLI flags**.

**DeepSeek (default):**

```yaml
provider: deepseek
base_url: https://api.deepseek.com/v1
endpoint: /chat/completions
model: deepseek-v4-pro
api_key_env: DEEPSEEK_API_KEY
```

```env
DEEPSEEK_API_KEY=sk-your-key-here
```

**OpenAI:**

```yaml
provider: openai
base_url: https://api.openai.com/v1
endpoint: /chat/completions
model: gpt-5
api_key_env: OPENAI_API_KEY
```

```env
OPENAI_API_KEY=sk-...
```

**OpenRouter:**

```yaml
provider: openrouter
model: anthropic/claude-sonnet-4
api_key_env: OPENROUTER_API_KEY
```

```env
OPENROUTER_API_KEY=sk-...
```

**Groq:**

```yaml
provider: groq
model: llama-3.3-70b-versatile
api_key_env: GROQ_API_KEY
```

```env
GROQ_API_KEY=sk-...
```

**Ollama (local):**

```yaml
provider: ollama
model: llama3.1
api_key_env: OLLAMA_API_KEY  # opsyonal para sa local; mag-set ng kahit anong pangalan, o umasa sa registry URL
```

```env
OLLAMA_API_KEY=sk-...
```

**Custom OpenAI-compatible provider (explicit `base_url`/`endpoint`):**

```yaml
provider: my-company-proxy
base_url: https://llm.gateway.example.com/v1
endpoint: /chat/completions
model: custom-model-1
api_key_env: MY_PROXY_API_KEY
```

```env
MY_PROXY_API_KEY=sk-...
```

Mga kilalang provider na may built-in URL registrations (ang explicit `base_url` ay laging mananalo):

| Provider | Default na Base URL |
|---|---|
| `deepseek` | `https://api.deepseek.com/v1` |
| `openai` | `https://api.openai.com/v1` |
| `openrouter` | `https://openrouter.ai/api/v1` |
| `groq` | `https://api.groq.com/openai/v1` |
| `ollama` | `http://localhost:11434/v1` |

**Anthropic:**

```yaml
provider: anthropic
model: claude-sonnet-4-5
api_key_env: ANTHROPIC_API_KEY
```

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

> Hindi pinapansin ng Anthropic ang `base_url` at `endpoint` — nakapirmi sa client ang URL ng Messages API nito.

**Fallback block (opsyonal; parehong routing rules gaya ng main block):**

```yaml
fallback:
  provider: deepseek
  base_url: https://api.deepseek.com/v1
  model: deepseek-v4-flash
  api_key_env: DEEPSEEK_API_KEY
```

**Mga Routing Rule:**

1. Laging mananalo ang explicit na `base_url` kaysa sa built-in provider URL registry.
2. Kapag hindi isinama ang `base_url`, ginagamit ang registry entry para sa `deepseek`/`openai`/`openrouter`/`groq`/`ollama`.
3. Ang `endpoint` ay default sa `/chat/completions` kapag hindi isinama.
4. **Walang CLI flag para sa pagpapalit ng provider** — ang provider switching ay config-file-driven (`agent/config/llm.yaml`) lamang.

Pagkatapos i-edit ang `agent/config/llm.yaml`, i-restart ang anumang tumatakbong likha process para ma-load ang bagong provider.

---

## Database Layer

Sinusuportahan ng likha ang parehong SQLite at PostgreSQL para sa persistent storage.

### SQLite

- Default na database para sa local development
- File-based, walang kailangang server
- Ginagamit kapag walang naka-set na `DATABASE_URL`

### PostgreSQL

- Production database para sa API server
- Naka-configure sa pamamagitan ng `DATABASE_URL` environment variable
- Sumusuporta sa migrations, task history, phase reports, WBS, at telemetry

### Initialization

```bash
# I-initialize ang database (gagawa ng mga table)
npm run init-db
```

### Mga Database Store

| Store | Paglalarawan |
|-------|-------------|
| `TaskHistoryStore` | History ng task execution |
| `PhaseReportStore` | Mga ulat bawat phase |
| `WbsStore` | Mga entry ng Work Breakdown Structure |
| `PlanStore` | Mga naka-save na plano |
| `ProjectStore` | Mga configuration ng project |

---

## Development

### Setup

```bash
# Buong setup (interactive)
npm run setup

# Non-interactive na setup
npm run setup:non-interactive
```

### Mga Script

| Script | Paglalarawan |
|--------|-------------|
| `npm run build` | I-compile ang TypeScript at kopyahin ang agent files |
| `npm run dev` | Magpatakbo sa dev mode (ts-node) |
| `npm test` | Patakbuhin ang test suite (Vitest) |
| `npm run test:watch` | Patakbuhin ang mga test sa watch mode |
| `npm run likha:link` | I-link ang likha nang global sa pamamagitan ng npm link |
| `npm run likha:unlink` | I-unlink ang global likha |
| `npm run likha:install` | I-install ang lahat ng dependency (kasama ang UI) |
| `npm run likha:build` | I-build ang parehong CLI at UI |
| `npm run likha:ui` | Sabay na simulan ang API + UI |
| `npm run likha:api` | Simulan lamang ang API server |
| `npm run package:build` | I-build ang distributable package |
| `npm run package:validate` | I-validate ang package |
| `npm run package:tarball` | Gumawa ng tarball |
| `npm run package:docker` | I-build ang Docker image |
| `npm run package:all` | I-build ang lahat ng package formats |
| `npm run init-db` | I-initialize ang mga database table |

### Testing

```bash
# Patakbuhin ang lahat ng test
npm test

# Patakbuhin ang isang partikular na test file
npx vitest run src/core/__tests__/iterationReasonDedup.test.ts

# Patakbuhin ang mga test sa watch mode
npm run test:watch
```

### Pagdaragdag ng Bagong Skill

1. Gumawa ng directory: `agent/skills/<name>/`
2. Gumawa ng `SKILL.md` na may YAML frontmatter:

```markdown
---
name: my-skill
role: My Role
description: What this skill does
triggers:
  - keyword1
  - keyword2
version: "1.0"
requires_tools: []
composes_with: []
---

## Role
Description of the role.

## Process
Step-by-step process.

## Strategies
Strategies and approaches.

## Instructions
Specific instructions.
```

3. Patakbuhin ang `likha --skills` para ma-verify na naka-load ito

### Pagdaragdag ng Bagong Engine

1. I-implement ang `IReactEngine` interface (at opsyonal na `IReactEngineV2`)
2. I-rehistro ito sa `src/core/engine/EngineRegistry.ts`:

```typescript
registerEngine("my-engine", ({ llm, telemetry, io, options }) => {
  return new MyEngine(llm, telemetry, myOpts);
});
```

3. Gamitin ito: `likha --engine my-engine --task "..."`

---

## Project Structure



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
tasks/           Runtime output: todo.md, wbs.md, lessons.md, phase reports (git-ignored sa praktika)
.log/            Runtime output: FileTelemetry logs (git-ignored sa praktika)
```
