<!-- ronin:version 2 | ronin:task task-d8bbc5 | ronin:updated 2026-08-13T07:22:57.680Z | ronin:subtask code-st-db60d1 -->
# xcoder â€” Usage

How to invoke the xcoder CLI, run tasks, drive the API server and UI, select an orchestration engine, and run tests.

## CLI Syntax

```bash
xcoder [task] [options]
```

The positional `[task]` argument is equivalent to `--task <description>`. After a build, the CLI lives at `dist/cli/index.js`; the npm scripts and the global `xcoder` binary both resolve there.

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
xcoder "Refactor the authentication module to use JWT tokens"

# Explicit task option with the lean engine
xcoder --engine lean --task "Analyze the test coverage"

# Interactive chat mode (workspace = current folder)
xcoder --chat

# List all loaded skills and their trigger keywords
xcoder --skills

# Index the current workspace into .agent/index/
xcoder --index

# Record a lesson to tasks/lessons.md
xcoder --lesson "Always validate file paths before writing"

# Fully autonomous mode â€” auto-answers ALL interactive prompts
xcoder --auto --task "Set up CI/CD pipeline"

# Runtime diagnostics
xcoder --audit-react
xcoder --diagnose-live
```

Plan mode is controlled explicitly:

```bash
# Force Plan Mode on
xcoder --plan --task "Complex task"

# Force Plan Mode off
xcoder --no-plan --task "Quick task"

# Run as a single ReAct loop (disable phase planning)
xcoder --single-phase --task "Complex task"
```

## API Server & UI

### API Server

The Express-based API server exposes routes under `/api/v1` (task execution, plans, telemetry, skills, task history, phase reports, WBS, and user management):

```bash
# Start the API server on the default port (3001)
xcoder --serve

# Start the API server on an explicit port
xcoder --serve --port 3001

# npm script wrapper for the same command
npm run xcoder:api
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
xcoder --ui

# npm script wrapper: API on 3001 + UI dev server
npm run xcoder:ui
```

## Engine Selection

xcoder ships eight interchangeable orchestration engines, all implementing the `IReactEngine` / `IReactEngineV2` interfaces. Select one with `--engine <name>`:

```bash
xcoder --engine <name> --task "List all TypeScript files in src/"
```

| Engine | Registration Name | Description |
|---|---|---|
| **ReActOrchestrator** | `react` (default) | Full-featured engine with plan mode, phase planning, subagent delegation, goal validation, and self-healing |
| **LeanEngine** | `lean` | Focused, self-contained ReAct loop; supports the V2 lifecycle |
| **SimpleReactEngine** | `simple` | The bare ReAct loop with no Plan Mode, Phase Planning, or goal-validation retry |
| **LangGraphEngine** | `langgraph` | ReAct loop built on `@langchain/langgraph`'s StateGraph; supports the V2 lifecycle |
| **SwarmEngine** | `swarm` | Parallel swarm orchestration with WBS decomposition and concurrent agent dispatch |
| **AgenticEngine** | `agentic` | Deterministic agentic ReAct loop with an injectable ThinkFn |
| **BrainEngine** | `brain` | Routes a task across â‰¥2 roles via the shared MultiRoleRouter |
| **ProcedureEngine** | `procedure` | Two-step procedure generation plus local step execution |

Engines are registered in `src/core/engine/EngineRegistry.ts` via a factory pattern. New implementations can be added with `registerEngine("name", factory)` â€” no CLI or API changes required.

## LLM Provider Selection

xcoder's LLM backend is config-driven and provider-agnostic. **DeepSeek is the default**;
any OpenAI-compatible provider (OpenAI, OpenRouter, Groq, Ollama, a company proxy, â€¦) and
Anthropic are switchable through `agent/config/llm.yaml` + one API key env var â€” no code
changes and no CLI flag. Keys are never inlined in yaml: `api_key_env` names the environment
variable holding the key.

```yaml
# agent/config/llm.yaml â€” OpenAI-compatible example
provider: openai
base_url: https://api.openai.com/v1        # explicit base_url always wins; omit for known providers
endpoint: /chat/completions                # defaults to /chat/completions when omitted
model: gpt-5
api_key_env: OPENAI_API_KEY
```

```yaml
# agent/config/llm.yaml â€” Anthropic example (base_url/endpoint unused; fixed Messages API URL)
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

- [readme.md](./readme.md) â€” overview and quick start
- [setup.md](./setup.md) â€” installation and environment configuration
- [blurprint.md](./blurprint.md) â€” architecture blueprint and extension points
