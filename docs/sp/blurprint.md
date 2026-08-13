<!-- ronin:version 1 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T16:59:09.860Z | ronin:subtask code-st-d23750 -->
# xcoder — Arquitectura

Cómo funciona xcoder internamente: objetivos de diseño, abstracciones principales, motores, sistema de habilidades, servidor API e interfaz, topología de despliegue, referencia de directorios y puntos de extensión.

## Objetivos de diseño

La arquitectura se organiza en torno a cuatro objetivos:

1. **El motor de orquestación es intercambiable.** El bucle ReAct (`ReActOrchestrator`) es una implementación de la interfaz `IReactEngine`, no una dependencia codificada de la CLI o la API.
2. **La presentación no es asunto del motor.** El motor informa el progreso y solicita aprobación a través de una interfaz `AgentIO`; no tiene idea de si se comunica con una terminal, una solicitud HTTP o un arnés de prueba.
3. **La CLI y la base de datos están desacopladas.** Una ejecución `xcoder --task "..."` nunca abre una conexión de base de datos. Solo el servidor API (que respalda la interfaz) persiste en la base de datos.
4. **El comportamiento se extiende mediante habilidades, no bifurcaciones.** La experiencia de dominio vive en `agent/skills/*/SKILL.md` y se selecciona en tiempo de ejecución mediante enrutamiento de palabras clave, no se compila en el bucle central.

## Diagrama del sistema

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

## Abstracciones principales

### `IReactEngine` (`src/core/engine/IReactEngine.ts`)

El contrato mínimo que todo motor de orquestación debe implementar: `run()`, `generatePlan()`, `selectSkills()`, más los getters de estado (`getLastOutcome`, `getCumulativeUsage`, `getHealthScore`, `getPartialSuccess`, `getSubagentLimitContext`). Nada fuera de `src/core/engine/` debe importar `ReActOrchestrator` directamente — pasa por el registro en su lugar.

### `EngineRegistry` (`src/core/engine/EngineRegistry.ts`)

Los motores se registran por nombre mediante un patrón de fábrica:

```ts
registerEngine("react", (deps) => new ReActOrchestrator(deps.llm, deps.telemetry, { ...deps.options, io: deps.io }));
```

Seleccionar un motor solo requiere `registerEngine("your-name", factory)` — no se necesitan cambios en la CLI/API.

### `AgentIO` (`src/core/io/AgentIO.ts`)

`AgentIO` se divide en `AgentReporter` (unidireccional: `log`, `thought`, `action`, `observation`, `usage`, `spinnerStart`/`spinnerStop`) y `AgentPrompter` (`confirm(message, opts)` — la única llamada bidireccional, usada para la aprobación del plan y la continuación tras el límite de iteraciones).

Se incluyen dos implementaciones:

- **`CliIO`** (`src/cli/CliIO.ts`) — informes de terminal con color ANSI, un spinner y avisos `readline` reales en stdin. Aquí es donde vive la "funcionalidad CLI"; no forma parte del motor.
- **`AutoIO`** (`src/core/io/AutoIO.ts`) — la implementación predeterminada. Registra en la consola para visibilidad pero **nunca lee stdin**; `confirm()` se resuelve inmediatamente con un valor predeterminado. Esto es lo que permite que el motor se ejecute de forma segura dentro de un manejador de solicitudes de la API — una ejecución sin interfaz nunca puede quedarse colgada esperando un aviso que nadie responderá.

## Motores

Los ocho motores implementan `IReactEngine` / la interfaz del ciclo de vida V2 (`cancel`, `onProgress`, `getState`, `getLastMessages`, `getWorkspacePath`, `getIterationCount`):

| Motor | Nombre de registro | Descripción |
|---|---|---|
| **ReActOrchestrator** | `react` (predeterminado) | Motor completo con modo Plan, planificación por fases, delegación a subagentes, validación de objetivos y autocuración |
| **LeanEngine** | `lean` | Bucle ReAct enfocado y autocontenido — el bucle central sin modo Plan ni subagentes. Admite el ciclo de vida V2 |
| **LangGraphEngine** | `langgraph` | Bucle ReAct construido sobre StateGraph de `@langchain/langgraph` con una máquina de estados explícita de dos nodos (agente ↔ herramientas). Admite el ciclo de vida V2 |
| **SwarmEngine** | `swarm` | Orquestación de enjambre en paralelo con descomposición WBS y envío concurrente de agentes. Admite el ciclo de vida V2 |
| **SimpleReactEngine** | `simple` | Bucle ReAct mínimo sin modo Plan, planificación por fases ni reintento de validación de objetivos |
| **AgenticEngine** | `agentic` | Bucle ReAct agéntico determinista con un ThinkFn inyectable |
| **BrainEngine** | `brain` | Enruta una tarea a través de ≥2 roles mediante el MultiRoleRouter compartido |
| **ProcedureEngine** | `procedure` | Generación de procedimiento en dos pasos más ejecución local de pasos |

Los motores también se pueden crear programáticamente:

```ts
const engine = createEngine("lean", { llm, telemetry, io, options });
console.log(listEngines()); // ["react", "lean", "simple", "swarm", "langgraph", "agentic", "brain", "procedure"]
```

## Sistema de habilidades

`SkillRegistry` (`src/core/skillRegistry.ts`) carga cada `agent/skills/<name>/SKILL.md`:

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

`route(taskDescription)` convierte la tarea a minúsculas y cuenta cuántos desencadenantes son subcadenas literales de ella. **Esto es coincidencia de subcadenas simple sin límites de palabras** — un desencadenante como `"ux"` coincide dentro de `"SELinux"`, `"pod"` coincide dentro de `"podcast"` y `"git"` coincide dentro de `"digital"`. Por lo tanto, los desencadenantes deben elegirse de forma defensiva (frases más largas, o límites explícitos de espacio final como `"the pod "`).

Ejecuta `xcoder --skills` para obtener la lista en vivo de habilidades con roles y desencadenantes.

## Servidor API e interfaz

- Servidor Express (`src/api/server.ts`) con rutas montadas en `/api/v1` (`src/api/routes.ts`). Endpoints clave: `/chat` (ejecutar una tarea), `/chat/plan` + `/chat/execute` (aprobación de plan en dos fases para la interfaz), `/telemetry`, `/skills`, `/task-history`, `/phase-reports`, `/wbs`, `/settings/llm-key`, más autenticación (`/login`, `/logout`, `/register`, `/users`).
- Autenticación opcional por token Bearer vía `XCODER_API_KEY` — si no está definida, la API se ejecuta sin autenticación con una advertencia al inicio.
- Interfaz React (`ui/`) — los tokens de diseño y las primitivas compartidas (`Card`, `Button`, `Badge`, `PageHeader`) viven en `ui/src/index.css` y `ui/src/components/ui/`. Las páginas consumen la API directamente; no hay capa de renderizado del lado del servidor.

## Topología de despliegue

`xcoder --deploy --docker [--remote <ip>] [--llm true|false]`: 

- **Sin `--remote`:** `docker compose up -d --build` localmente — directamente o, con `--llm true`, entregado al motor como tarea devops para que pueda diagnosticar y corregir una compilación fallida.
- **Con `--remote <ip>`:** se conecta por SSH al host remoto (`REMOTE_SSH_USER`/`REMOTE_SSH_PASSWORD` desde `.env`) y despliega allí en su lugar; `--remote-path` predetermina a `/opt/xcoder`.

## Referencia de directorios

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

## Puntos de extensión

- **Nuevo motor** — implementa `IReactEngine`, luego `registerEngine("name", factory)`; mira el registro de `"react"` por el propio `EngineRegistry.ts` como plantilla.
- **Nueva habilidad** — agrega `agent/skills/<name>/SKILL.md`; mira la habilidad `skill-authoring` para el esquema y las reglas de seguridad de desencadenantes.
- **Nueva herramienta** — agrega una entrada de esquema en `toolSchemas.ts` y un caso en `toolDispatcher.ts`.
- **Nuevo backend de E/S** (por ejemplo, una futura TUI o un modo API transmitido por WebSocket) — implementa `AgentIO`.

## Pasos siguientes

- [readme.md](./readme.md) — resumen e inicio rápido
- [setup.md](./setup.md) — instalación y configuración del entorno
- [usage.md](./usage.md) — referencia de la CLI, selección del motor y pruebas
