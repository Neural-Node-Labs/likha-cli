<!-- ronin:version 6 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T17:04:15.325Z | ronin:subtask code-st-d23750 -->
# likha — Uso

Cómo invocar la CLI de likha, ejecutar tareas, manejar el servidor API y la interfaz, seleccionar un motor de orquestación y ejecutar pruebas.

## Sintaxis de la CLI

```bash
likha [task] [options]
```

El argumento posicional `[task]` equivale a `--task <description>`. Después de una compilación, la CLI se encuentra en `dist/cli/index.js`; los scripts npm y el binario global `likha` resuelven ambos allí.

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
likha "Refactorizar el módulo de autenticación para usar tokens JWT"

# Explicit task option with the lean engine
likha --engine lean --task "Analizar la cobertura de pruebas"

# Interactive chat mode (workspace = current folder)
likha --chat

# List all loaded skills and their trigger keywords
likha --skills

# Index the current workspace into .agent/index/
likha --index

# Record a lesson to tasks/lessons.md
likha --lesson "Valida siempre las rutas de archivo antes de escribir"

# Fully autonomous mode — auto-answers ALL interactive prompts
likha --auto --task "Configurar un pipeline de CI/CD"

# Runtime diagnostics
elikha --audit-react
likha --diagnose-live
```

El modo Plan se controla explícitamente:

```bash
# Force Plan Mode on
likha --plan --task "Tarea compleja"

# Force Plan Mode off
likha --no-plan --task "Tarea rápida"

# Run as a single ReAct loop (disable phase planning)
likha --single-phase --task "Tarea compleja"
```

## Servidor API e interfaz

### Servidor API

El servidor API basado en Express expone rutas bajo `/api/v1` (ejecución de tareas, planes, telemetría, habilidades, historial de tareas, informes de fase, WBS y gestión de usuarios):

```bash
# Start the API server on the default port (3001)
likha --serve

# Start the API server on an explicit port
likha --serve --port 3001

# npm script wrapper for the same command
npm run likha:api
```

El puerto y el host también pueden provenir del entorno:

```env
XCODER_API_PORT=3001
XCODER_API_HOST=0.0.0.0
```

Si `XCODER_API_KEY` está definida, todos los endpoints `/api/v1/*` (excepto health/login/register/user-count) requieren `Authorization: Bearer <XCODER_API_KEY>`. Si no está definida, la API se ejecuta sin autenticación y registra una advertencia al inicio.

### Interfaz

La interfaz React (Vite + TypeScript) se ejecuta junto al servidor API:

```bash
# Start both API and UI
likha --ui

# npm script wrapper: API on 3001 + UI dev server
npm run likha:ui
```

## Selección del motor

likha incluye cuatro motores de orquestación intercambiables, todos implementan las interfaces `IReactEngine` / `IReactEngineV2`. Selecciona uno con `--engine <name>`:

```bash
likha --engine <name> --task "Lista todos los archivos TypeScript en src/"
```

| Motor | Nombre de registro | Descripción |
|---|---|---|
| **ReActOrchestrator** | `react` (predeterminado) | Motor completo con modo Plan, planificación por fases, delegación a subagentes, validación de objetivos y autocuración |
| **LeanEngine** | `lean` | Bucle ReAct enfocado y autocontenido; admite el ciclo de vida V2 |
| **LangGraphEngine** | `langgraph` | Bucle ReAct construido sobre StateGraph de `@langchain/langgraph`; admite el ciclo de vida V2 |
| **SwarmEngine** | `swarm` | Orquestación de enjambre en paralelo con descomposición WBS y envío concurrente de agentes |

Los motores se registran en `src/core/engine/EngineRegistry.ts` mediante un patrón de fábrica. Se pueden agregar nuevas implementaciones con `registerEngine("name", factory)` — no se requieren cambios en la CLI ni en la API.

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

- [readme.md](./readme.md) — resumen e inicio rápido
- [setup.md](./setup.md) — instalación y configuración del entorno
- [blurprint.md](./blurprint.md) — arquitectura y puntos de extensión
