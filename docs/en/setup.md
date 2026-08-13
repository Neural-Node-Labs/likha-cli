<!-- ronin:version 2 | ronin:task task-d8bbc5 | ronin:updated 2026-08-13T07:22:52.867Z | ronin:subtask code-st-db60d1 -->
# xcoder — Setup

How to install xcoder, configure its environment, initialize the database, and set up a development workflow.

## Prerequisites

- **Node.js >= 18**
- **npm** (required for UI dependencies)
- **DeepSeek API key** — set `DEEPSEEK_API_KEY` in your environment or `.env` file

## Installation

Install dependencies from the project root (this also installs the `ui/` frontend dependencies):

```bash
npm run xcoder:install
```

Then build the TypeScript sources (the `build` script also copies the `agent/` config directory into `dist/config/`):

```bash
npm run build
```

After building, the CLI is available at `dist/cli/index.js` and can be run with `npm start -- --task "..."`.

## Environment Configuration

Create a `.env` file in the project root. The minimal configuration is the DeepSeek API key:

```env
DEEPSEEK_API_KEY=sk-your-key-here
```

The following environment variables are supported:

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key (default provider — required for default runs) |
| `ANTHROPIC_API_KEY` | Anthropic API key — fallback, or switch by setting `provider: anthropic` in `agent/config/llm.yaml` |

> `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` are legacy and **not read** by xcoder. The active
> provider, base URL, endpoint, and model all live in `agent/config/llm.yaml`.

### LLM Providers

xcoder's LLM backend is config-driven: **DeepSeek is the default**, but any OpenAI-compatible
provider and Anthropic are switchable via `agent/config/llm.yaml` + one API key env var — no
code changes. See the README's [Configuration](#configuration) section for the provider-switch
examples (`openai`, `openrouter`, `groq`, `ollama`, `anthropic`, or any custom name with an
explicit `base_url`/`endpoint`).
| `GITHUB_TOKEN` | Token for `github_tool` HTTPS auth (clone/fetch/pull/push); passed as an in-memory auth header only |
| `XCODER_API_KEY` | API server bearer-token auth; if unset the API runs without authentication |
| `XCODER_API_PORT` | API server port (default: 3001) |
| `XCODER_API_HOST` | API server host (default: 0.0.0.0) |
| `MAX_ITERATIONS` | ReAct loop iteration ceiling per round |
| `XCODER_RESTRICT_TO_WORKSPACE` | Safety rail: refuse `read_tool`/`write_edit_tool` paths outside the working directory |
| `DATABASE_TYPE` | Database backend: `sqlite` (default) or `postgres` |
| `DATABASE_SQLITE_PATH` | Path to the SQLite database file (default: `~/.xcoder/data/xcoder.db`) |
| `DATABASE_URL` | PostgreSQL connection string (overrides individual params below) |
| `DATABASE_HOST` | PostgreSQL host |
| `DATABASE_PORT` | PostgreSQL port |
| `DATABASE_NAME` | PostgreSQL database name |
| `DATABASE_USER` | PostgreSQL user |
| `DATABASE_PASSWORD` | PostgreSQL password |
| `DATABASE_SSL` | Enable PostgreSQL SSL |
| `DATABASE_POOL_MAX` | PostgreSQL pool max connections |
| `DATABASE_POOL_IDLE` | PostgreSQL pool idle timeout (ms) |
| `DATABASE_POOL_TIMEOUT` | PostgreSQL pool acquire timeout (ms) |
| `REMOTE_SSH_USER` | SSH user for remote deploy |
| `REMOTE_SSH_PASSWORD` | SSH password for remote deploy |
| `XCODER_SSH_TARGETS` | Fleet SSH targets (`host1:22,host2:22`) |
| `XCODER_SSH_USER` | Fleet SSH user |
| `XCODER_SSH_PASSWORD` | Fleet SSH password |

A fuller `.env` template:

```env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
# MAX_ITERATIONS=25
# XCODER_API_PORT=3001
# XCODER_API_HOST=0.0.0.0
# DATABASE_URL=postgresql://user:pass@localhost:5432/xcoder
# REMOTE_SSH_USER=deploy
# REMOTE_SSH_PASSWORD=your-password
# XCODER_SSH_TARGETS=host1:22,host2:22
# XCODER_SSH_USER=fleet-user
# XCODER_SSH_PASSWORD=fleet-password
```

## Database Initialization

SQLite is the zero-config default. To use the database-backed stores (task history, phase reports, WBS, telemetry), initialize the schema:

```bash
npm run init-db
```

For PostgreSQL, set `DATABASE_TYPE=postgres` and a `DATABASE_URL` (or the individual `DATABASE_*` parameters) before running `npm run init-db`.

## Development Setup

Run from source without a build step:

```bash
npm run dev -- --task "List all TypeScript files in src/"
```

Run the test suite:

```bash
npm test
```

Watch mode for tests:

```bash
npm run test:watch
```

Interactive setup helpers are also available:

```bash
npm run setup
npm run setup:non-interactive
```

## Next Steps

- [readme.md](./readme.md) — overview and quick start
- [usage.md](./usage.md) — CLI reference, engine selection, and testing
- [blurprint.md](./blurprint.md) — architecture blueprint
