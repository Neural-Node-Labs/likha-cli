<!-- ronin:version 2 | ronin:task task-b5feec | ronin:updated 2026-08-13T08:17:53.918Z | ronin:subtask code-st-82c66c -->
# xcoder — Resumen

**xcoder** es un agente CLI ReAct escrito en TypeScript para Node.js. Combina el bucle ReAct (razonamiento + acción) con habilidades de rol conectables en caliente y usa DeepSeek como proveedor LLM predeterminado. El backend LLM se controla por configuración: DeepSeek es el proveedor predeterminado, y cualquier proveedor compatible con OpenAI o Anthropic se puede seleccionar mediante `agent/config/llm.yaml` más una variable de entorno para la clave API — **sin cambios de código**. Este documento es el punto de entrada del conjunto de documentación en español.

## Resumen

xcoder es un agente CLI que sigue el patrón **ReAct**: piensa de forma iterativa sobre la tarea, llama a herramientas para recopilar información o hacer cambios, observa los resultados y repite hasta completar la tarea. Admite múltiples motores de orquestación, directivas de habilidades conectables en caliente, planificación por fases, un servidor HTTP API, una interfaz React y un mecanismo de autocuración integrado que detecta cuando el agente está atascado.

La versión 0.2.0 incluye cuatro motores de orquestación intercambiables (`react` por defecto, `lean`, `langgraph`, `swarm`) y más de 30 habilidades especializadas cargadas desde `agent/skills/`.

## Características principales

- **Bucle ReAct** — fases Búsqueda → Acción → Validación
- **Implementaciones de motores múltiples** — ReAct estándar, LeanEngine, LangGraph y Swarm
- **Sistema de habilidades conectable en caliente** — más de 30 habilidades especializadas (programador, arquitecto, devops, tester, etc.) cargadas desde `agent/skills/`
- **Modo Plan** — genera un plan de tarea antes de la ejecución, con aprobación del usuario
- **Planificación por fases** — divide tareas complejas en fases secuenciales con contexto aislado
- **Puntuación de salud autocurable** — detecta progreso estancado y devuelve al agente al buen camino
- **Servidor HTTP API** — API REST basada en Express para la ejecución remota de tareas
- **Interfaz React** — frontend Vite + TypeScript para gestionar tareas, planes y telemetría

## Primeros pasos

Asegúrate de que `DEEPSEEK_API_KEY` esté definida en tu entorno o en un archivo `.env`, luego instala y compila:

```bash
npm run xcoder:install
npm run build
```

Ejecuta tu primera tarea:

```bash
npm start -- --task "Lista todos los archivos TypeScript en src/"
```

¿No necesitas un paso de compilación? Usa el runner de desarrollo en su lugar:

```bash
npm run dev -- --task "Lista todos los archivos TypeScript en src/"
```

## Pasos siguientes

- [setup.md](./setup.md) — requisitos previos, instalación y configuración del entorno
- [usage.md](./usage.md) — referencia de la CLI, selección del motor y pruebas
- [blurprint.md](./blurprint.md) — arquitectura, abstracciones principales y puntos de extensión
