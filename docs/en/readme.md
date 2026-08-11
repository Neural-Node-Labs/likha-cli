<!-- ronin:version 1 | ronin:task task-eedb5e | ronin:updated 2026-08-11T16:14:47.612Z | ronin:subtask code-st-7639c0 -->
# xcoder — Overview

**xcoder** is a ReAct CLI agent written in TypeScript for Node.js. It pairs the ReAct (Reasoning + Acting) loop with hot-pluggable role skills, and uses DeepSeek as its default LLM provider. This document is the entry point to the English documentation set.

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
