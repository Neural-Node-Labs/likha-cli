# xcoder Documentation

This directory contains detailed documentation for the xcoder orchestration engine system.

## Contents

| Document | Description |
|---|---|
| [swarm-engine.md](swarm-engine.md) | SwarmEngine: validation rules, healing features, API reference, and usage examples |

## Related Documents

- [README.md](../../README.md) — Quick start, CLI reference, configuration
- [blueprint.md](../../blueprint.md) — Architecture blueprint, system design, core abstractions

## Engine Overview

xcoder supports multiple orchestration engines, all implementing the `IReactEngine` / `IReactEngineV2` interfaces:

| Engine | Description | Registration Name |
|---|---|---|
| **ReActOrchestrator** | The original ReAct loop (reference implementation) | `"react"` |
| **LeanEngine** | Focused, self-contained ReAct loop with V2 lifecycle support | `"lean"` |
| **SwarmEngine** | Orchestrating engine that distributes tasks to parallel swarm agents via WBS | `"swarm"` |
| **LangGraphEngine** | LangGraph StateGraph-based ReAct loop | `"langgraph"` |

Engines are registered in `src/core/engine/EngineRegistry.ts` and selected via the `--engine <name>` CLI flag or the API's engine parameter.
