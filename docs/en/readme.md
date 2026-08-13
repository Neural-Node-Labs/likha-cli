<!-- ronin:version 3 | ronin:task task-b5feec | ronin:updated 2026-08-13T08:17:31.743Z | ronin:subtask code-st-82c66c -->
# xcoder — Overview

**xcoder** is a ReAct CLI agent written in TypeScript for Node.js. It pairs the ReAct (Reasoning + Acting) loop with hot-pluggable role skills, and uses DeepSeek as its default LLM provider. The LLM backend is config-driven: DeepSeek ships as the default, and any OpenAI-compatible provider or Anthropic can be selected through `agent/config/llm.yaml` plus one API key environment variable — **no code changes** (see [setup.md](./setup.md) and [usage.md](./usage.md)).

## Overview

xcoder is a CLI agent that follows the **ReAct** pattern: it iteratively thinks about a task, calls tools to gather information or make changes, observes the results, and repeats until the task is complete. It supports multiple orchestration engines, hot-pluggable skill directives, phase planning, an HTTP API server, a React UI, and a built-in self-healing mechanism that detects when the agent is stuck.

Version 0.2.0 ships with four interchangeable orchestration engines (`react` default, `lean`, `langgraph`, `swarm`) and more than 30 specialized skills loaded from `agent/skills/`.

## Key Features

- **ReAct loop** with Search → Action → Validation phases
- **Multiple engine implementations** — standard ReAct, LeanEngine, LangGraph, and Swarm
- **Hot-pluggable skill system** — 30+ specialized skills (programmer, architect, devops, tester, and more) loaded from `agent/skills/`
- **Plan Mode** — generates a task plan before execution, with user approval
- **Phase Planning** — divides complex tasks into sequential phases with isolated context
- **Self-healing health scoring** — detects stalled progress and nudges the agent back on track
- **HTTP API server** — Express-based REST API for remote task execution
- **React UI** — Vite + TypeScript frontend for managing tasks, plans, and telemetry

## Getting Started

Make sure `DEEPSEEK_API_KEY` is set in your environment or in a `.env` file, then install and build:

```bash
npm run xcoder:install
npm run build
```

Run your first task:

```bash
npm start -- --task "List all TypeScript files in src/"
```

No build step needed? Use the dev runner instead:

```bash
npm run dev -- --task "List all TypeScript files in src/"
```

## Next Steps

- [setup.md](./setup.md) — prerequisites, installation, and environment configuration
- [usage.md](./usage.md) — CLI reference, engine selection, and testing
- [blurprint.md](./blurprint.md) — architecture blueprint, core abstractions, and extension points
