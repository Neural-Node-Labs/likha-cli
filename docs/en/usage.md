<!-- ronin:version 2 | ronin:task task-d8bbc5 | ronin:updated 2026-08-13T07:22:57.680Z | ronin:subtask code-st-db60d1 -->
# likha — Usage

How to invoke the likha CLI, run tasks, drive the API server and UI, select an orchestration engine, and run tests.

## CLI Syntax

```bash
likha [task] [options]
```

The positional `[task]` argument is equivalent to `--task <description>`. After a build, the CLI lives at `dist/cli/index.js`; the npm scripts and the global `likha` binary both resolve there.

Common entry points:

```bash
# Run a task through the built CLI
npm start -- --task "List all TypeScript files in src/"

# Run from source (no build step needed)
npm run dev -- --task "List all TypeScript files in src/"

# Run the built entry point directly
node dist/cli/index.js
```

## Core Commands

The main task runner and agent commands work through the positional task argument or `--task`:

```bash
# Positional task (equivalent to --task)
likha "Refactor the authentication module to use JWT tokens"

# Explicit task option with the lean engine
likha --engine lean --task "Analyze the test coverage"

# Interactive chat mode (workspace = current folder)
likha --chat

# List all loaded skills and their trigger keywords
likha --skills

# Index the current workspace into .agent/index/
likha --index

# Record a lesson to tasks/lessons.md
likha --lesson "Always validate file paths before writing"

# Fully autonomous mode — auto-answers ALL interactive prompts
likha --auto --task "Set up CI/CD pipeline"

# Runtime diagnostics
elikha --audit-react
likha --diagnose-live
```

Plan mode is controlled explicitly:

```bash
# Force Plan Mode on
likha --plan --task "Complex task"

# Force Plan Mode off
likha --no-plan --task "Quick task"

# Run as a single ReAct loop (disable phase planning)
likha --single-phase --task "Complex task"
```

## API Server & UI

### API Server

The Express-based API server exposes routes under `/api/v1` (task execution, plans, telemetry, skills, task history, phase reports, WBS, and user management):

```bash
# Start the API server on the default port (3001)
likha --serve

# Start the API server on an explicit port
likha --serve --port 3001

# npm script wrapper for the same command
npm run likha:api
```

The port and host can also come from the environment:

```env
XCODER_API_PORT=3001
XCODER_API_HOST=0.0.0.0
```

If `XCODER_API_KEY` is set, all `/api/v1/*` endpoints (except health/login/register/user-count) require `Authorization: Bearer <XCODER_API_KEY>`. If it is unset, the API runs without authentication and logs a warning at startup.

### UI

The React UI (Vite + TypeScript) runs alongside the API server:

```bash
# Start both API and UI
likha --ui

# npm script wrapper: API on 3001 + UI dev server
npm run likha:ui
```

## Engine Selection

likha ships four interchangeable orchestration engines, all implementing the `IReactEngine` / `IReactEngineV2` interfaces. Select one with `--engine <name>`:

```bash
likha --engine <name> --task "List all TypeScript files in src/"
```

| Engine | Registration Name | Description |
|---|---|---|
| **ReActOrchestrator** | `react` (default) | Full-featured engine with plan mode, phase planning, subagent delegation, goal validation, and self-healing |
| **LeanEngine** | `lean` | Focused, self-contained ReAct loop; supports the V2 lifecycle |
| **LangGraphEngine** | `langgraph` | ReAct loop built on `@langchain/langgraph`'s StateGraph; supports the V2 lifecycle |
| **SwarmEngine** | `swarm` | Parallel swarm orchestration with WBS decomposition and concurrent agent dispatch |

Engines are registered in `src/core/engine/EngineRegistry.ts` via a factory pattern. New implementations can be added with `registerEngine("name", factory)` — no CLI or API changes required.

## LLM Provider Selection

likha's LLM backend is config-driven and provider-agnostic. **DeepSeek is the default**;
any OpenAI-compatible provider (OpenAI, OpenRouter, Groq, Ollama, a company proxy, …) and
Anthropic are switchable through `agent/config/llm.yaml` + one API key env var — no code
changes and no CLI flag. Keys are never inlined in yaml: `api_key_env` names the environment
variable holding the key.

```yaml
# agent/config/llm.yaml — OpenAI-compatible example
provider: openai
base_url: https://api.openai.com/v1        # explicit base_url always wins; omit for known providers
endpoint: /chat/completions                # defaults to /chat/completions when omitted
model: gpt-5
api_key_env: OPENAI_API_KEY
```

```yaml
# agent/config/llm.yaml — Anthropic example (base_url/endpoint unused; fixed Messages API URL)
provider: anthropic
model: claude-sonnet-4-5
api_key_env: ANTHROPIC_API_KEY
```

Known providers with built-in URL registrations: `deepseek` (`https://api.deepseek.com/v1`),
`openai` (`https://api.openai.com/v1`), `openrouter` (`https://openrouter.ai/api/v1`),
`groq` (`https://api.groq.com/openai/v1`), `ollama` (`http://localhost:11434/v1`).

## Testing

Run the full test suite (Vitest):

```bash
npm test
```

Re-run tests in watch mode during development:

```bash
npm run test:watch
```

## Next Steps

- [readme.md](./readme.md) — overview and quick start
- [setup.md](./setup.md) — installation and environment configuration
- [blurprint.md](./blurprint.md) — architecture blueprint and extension points
