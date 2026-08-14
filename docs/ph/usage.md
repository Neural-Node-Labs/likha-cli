<!-- ronin:version 1 | ronin:task task-eedb5e | ronin:updated 2026-08-11T16:16:09.127Z | ronin:subtask code-st-7639c0 -->
# likha — Paggamit

Gabay ito sa pag-invoke ng likha CLI, pagpapatakbo ng mga task, paggamit ng API server at UI, pagpili ng orchestration engine, at pagpapatakbo ng mga test.

## CLI Syntax

```bash
likha [task] [options]
```

Ang positional na `[task]` argument ay katumbas ng `--task <description>`. Pagkatapos mag-build, ang CLI ay nasa `dist/cli/index.js`; parehong tumuturo doon ang mga npm scripts at ang global na `likha` binary.

Mga karaniwang entry point:

```bash
# Patakbuhin ang isang task gamit ang built CLI
npm start -- --task "List all TypeScript files in src/"

# Patakbuhin mula sa source (walang build step na kailangan)
npm run dev -- --task "List all TypeScript files in src/"

# Direktang patakbuhin ang built entry point
node dist/cli/index.js
```

## Mga Pangunahing Command

Ang pangunahing task runner at iba pang agent commands ay gumagana sa pamamagitan ng positional task argument o ng `--task`:

```bash
# Positional task (katumbas ng --task)
likha "Refactor the authentication module to use JWT tokens"

# Explicit task option gamit ang lean engine
likha --engine lean --task "Analyze the test coverage"

# Interactive chat mode (workspace = kasalukuyang folder)
likha --chat

# Ilista ang lahat ng na-load na skills at ang kanilang mga trigger keywords
likha --skills

# I-index ang kasalukuyang workspace papunta sa .agent/index/
likha --index

# Magtala ng lesson sa tasks/lessons.md
likha --lesson "Always validate file paths before writing"

# Fully autonomous mode — awtomatikong sinasagot ang LAHAT ng interactive prompts
likha --auto --task "Set up CI/CD pipeline"

# Runtime diagnostics
likha --audit-react
likha --diagnose-live
```

Ang plan mode ay maaaring kontrolin nang tahasan:

```bash
# Puwersahang i-on ang Plan Mode
likha --plan --task "Complex task"

# Puwersahang i-off ang Plan Mode
likha --no-plan --task "Quick task"

# Patakbuhin bilang isang solong ReAct loop (i-disable ang phase planning)
likha --single-phase --task "Complex task"
```

## API Server at UI

### API Server

Ang Express-based API server ay may mga route sa ilalim ng `/api/v1` (task execution, plans, telemetry, skills, task history, phase reports, WBS, at user management):

```bash
# Simulan ang API server sa default port (3001)
likha --serve

# Simulan ang API server sa explicit port
likha --serve --port 3001

# npm script wrapper para sa parehong command
npm run likha:api
```

Ang port at host ay maaari ding manggaling sa environment:

```env
XCODER_API_PORT=3001
XCODER_API_HOST=0.0.0.0
```

Kung naka-set ang `XCODER_API_KEY`, ang lahat ng `/api/v1/*` endpoints (maliban sa health/login/register/user-count) ay mangangailangan ng `Authorization: Bearer <XCODER_API_KEY>`. Kung hindi ito naka-set, ang API ay tatakbo nang walang authentication at magla-log ng warning sa startup.

### UI

Ang React UI (Vite + TypeScript) ay tumatakbo kasama ng API server:

```bash
# Simulan ang parehong API at UI
likha --ui

# npm script wrapper: API sa 3001 + UI dev server
npm run likha:ui
```

## Pagpili ng Engine

Ang likha ay may apat na interchangeable orchestration engines, lahat ay nagpapatupad ng `IReactEngine` / `IReactEngineV2` interfaces. Pumili ng isa gamit ang `--engine <name>`:

```bash
likha --engine <name> --task "List all TypeScript files in src/"
```

| Engine | Registration Name | Paglalarawan |
|---|---|---|
| **ReActOrchestrator** | `react` (default) | Full-featured engine na may plan mode, phase planning, subagent delegation, goal validation, at self-healing |
| **LeanEngine** | `lean` | Nakatutok at self-contained ReAct loop; sinusuportahan ang V2 lifecycle |
| **LangGraphEngine** | `langgraph` | ReAct loop na binuo sa `@langchain/langgraph`'s StateGraph; sinusuportahan ang V2 lifecycle |
| **SwarmEngine** | `swarm` | Parallel swarm orchestration na may WBS decomposition at concurrent agent dispatch |

Ang mga engine ay nirerehistro sa `src/core/engine/EngineRegistry.ts` sa pamamagitan ng factory pattern. Ang mga bagong implementation ay maaaring idagdag gamit ang `registerEngine("name", factory)` — walang kinakailangang pagbabago sa CLI o API.

## Pagte-test

Patakbuhin ang buong test suite (Vitest):

```bash
npm test
```

I-re-run ang mga test sa watch mode habang nagde-develop:

```bash
npm run test:watch
```

## Mga Susunod na Hakbang

- [readme.md](./readme.md) — pangkalahatang-ideya at mabilisang pagsisimula
- [setup.md](./setup.md) — pag-install at configuration ng environment
- [blurprint.md](./blurprint.md) — architecture blueprint at extension points
