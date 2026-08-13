<!-- ronin:version 6 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T17:04:15.325Z | ronin:subtask code-st-d23750 -->
# xcoder â€” Uso

CÃ³mo invocar la CLI de xcoder, ejecutar tareas, manejar el servidor API y la interfaz, seleccionar un motor de orquestaciÃ³n y ejecutar pruebas.

## Sintaxis de la CLI

```bash
xcoder [task] [options]
```

El argumento posicional `[task]` equivale a `--task <description>`. DespuÃ©s de una compilaciÃ³n, la CLI se encuentra en `dist/cli/index.js`; los scripts npm y el binario global `xcoder` resuelven ambos allÃ­.

Puntos de entrada comunes:

```bash
# Run a task through the built CLI
npm start -- --task "Lista todos los archivos TypeScript en src/"

# Run from source (no build step needed)
npm run dev -- --task "Lista todos los archivos TypeScript en src/"

# Run the built entry point directly
node dist/cli/index.js
```

## Comandos principales

El ejecutor principal de tareas y los comandos del agente funcionan mediante el argumento posicional de tarea o `--task`:

```bash
# Positional task (equivalent to --task)
xcoder "Refactorizar el mÃ³dulo de autenticaciÃ³n para usar tokens JWT"

# Explicit task option with the lean engine
xcoder --engine lean --task "Analizar la cobertura de pruebas"

# Interactive chat mode (workspace = current folder)
xcoder --chat

# List all loaded skills and their trigger keywords
xcoder --skills

# Index the current workspace into .agent/index/
xcoder --index

# Record a lesson to tasks/lessons.md
xcoder --lesson "Valida siempre las rutas de archivo antes de escribir"

# Fully autonomous mode â€” auto-answers ALL interactive prompts
xcoder --auto --task "Configurar un pipeline de CI/CD"

# Runtime diagnostics
xcoder --audit-react
xcoder --diagnose-live
```

El modo Plan se controla explÃ­citamente:

```bash
# Force Plan Mode on
xcoder --plan --task "Tarea compleja"

# Force Plan Mode off
xcoder --no-plan --task "Tarea rÃ¡pida"

# Run as a single ReAct loop (disable phase planning)
xcoder --single-phase --task "Tarea compleja"
```

## Servidor API e interfaz

### Servidor API

El servidor API basado en Express expone rutas bajo `/api/v1` (ejecuciÃ³n de tareas, planes, telemetrÃ­a, habilidades, historial de tareas, informes de fase, WBS y gestiÃ³n de usuarios):

```bash
# Start the API server on the default port (3001)
xcoder --serve

# Start the API server on an explicit port
xcoder --serve --port 3001

# npm script wrapper for the same command
npm run xcoder:api
```

El puerto y el host tambiÃ©n pueden provenir del entorno:

```env
XCODER_API_PORT=3001
XCODER_API_HOST=0.0.0.0
```

Si `XCODER_API_KEY` estÃ¡ definida, todos los endpoints `/api/v1/*` (excepto health/login/register/user-count) requieren `Authorization: Bearer <XCODER_API_KEY>`. Si no estÃ¡ definida, la API se ejecuta sin autenticaciÃ³n y registra una advertencia al inicio.

### Interfaz

La interfaz React (Vite + TypeScript) se ejecuta junto al servidor API:

```bash
# Start both API and UI
xcoder --ui

# npm script wrapper: API on 3001 + UI dev server
npm run xcoder:ui
```

## SelecciÃ³n del motor

xcoder incluye ocho motores de orquestaciÃ³n intercambiables, todos implementan las interfaces `IReactEngine` / `IReactEngineV2`. Selecciona uno con `--engine <name>`:

```bash
xcoder --engine <name> --task "Lista todos los archivos TypeScript en src/"
```

| Motor | Nombre de registro | DescripciÃ³n |
|---|---|---|
| **ReActOrchestrator** | `react` (predeterminado) | Motor completo con modo Plan, planificaciÃ³n por fases, delegaciÃ³n a subagentes, validaciÃ³n de objetivos y autocuraciÃ³n |
| **LeanEngine** | `lean` | Bucle ReAct enfocado y autocontenido; admite el ciclo de vida V2 |
| **LangGraphEngine** | `langgraph` | Bucle ReAct construido sobre StateGraph de `@langchain/langgraph`; admite el ciclo de vida V2 |
| **SwarmEngine** | `swarm` | OrquestaciÃ³n de enjambre en paralelo con descomposiciÃ³n WBS y envÃ­o concurrente de agentes |
| **SimpleReactEngine** | `simple` | Bucle ReAct mÃ­nimo sin modo Plan, planificaciÃ³n por fases ni reintento de validaciÃ³n de objetivos |
| **AgenticEngine** | `agentic` | Bucle ReAct agÃ©ntico determinista con un ThinkFn inyectable |
| **BrainEngine** | `brain` | Enruta una tarea a travÃ©s de â‰¥2 roles mediante el MultiRoleRouter compartido |
| **ProcedureEngine** | `procedure` | GeneraciÃ³n de procedimiento en dos pasos mÃ¡s ejecuciÃ³n local de pasos |

Los motores se registran en `src/core/engine/EngineRegistry.ts` mediante un patrÃ³n de fÃ¡brica. Se pueden agregar nuevas implementaciones con `registerEngine("name", factory)` â€” no se requieren cambios en la CLI ni en la API.

## Pruebas

Ejecuta la suite de pruebas completa (Vitest):

```bash
npm test
```

Vuelve a ejecutar las pruebas en modo de vigilancia durante el desarrollo:

```bash
npm run test:watch
```

## Pasos siguientes

- [readme.md](./readme.md) â€” resumen e inicio rÃ¡pido
- [setup.md](./setup.md) â€” instalaciÃ³n y configuraciÃ³n del entorno
- [blurprint.md](./blurprint.md) â€” arquitectura y puntos de extensiÃ³n
