<!-- ronin:version 6 | ronin:task task-b5feec | ronin:updated 2026-08-13T08:18:33.117Z | ronin:subtask code-st-82c66c -->
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
| `OPENAI_API_KEY` | OpenAI API key (see `provider: openai` below) |
| `OPENROUTER_API_KEY` | OpenRouter API key (see `provider: openrouter` below) |
| `GROQ_API_KEY` | Groq API key (see `provider: groq` below) |
| `OLLAMA_API_KEY` | Ollama API key — optional for local use; set any name you like |
| `ANTHROPIC_API_KEY` | Anthropic API key — fallback, or switch by setting `provider: anthropic` in `agent/config/llm.yaml` |
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

> `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` are legacy and **not read** by xcoder. The active
> provider, base URL, endpoint, and model all live in `agent/config/llm.yaml`.

### LLM Providers

xcoder's LLM backend is config-driven and provider-agnostic: **DeepSeek is the default**, but any
OpenAI-compatible provider (OpenAI, OpenRouter, Groq, Ollama, a company proxy, …) and Anthropic
can be selected by editing `agent/config/llm.yaml` — **no code changes** and **no CLI flag for
switching providers** (provider switching is config-file-driven only).

Keys are never inlined in YAML. The `api_key_env` field names the environment variable that holds
the key; set exactly that variable in your environment or `.env` file. After editing
`agent/config/llm.yaml`, restart any running xcoder process.

**DeepSeek (default):**

```yaml
provider: deepseek
base_url: https://api.deepseek.com/v1
endpoint: /chat/completions
model: deepseek-v4-pro
api_key_env: DEEPSEEK_API_KEY
```

```env
DEEPSEEK_API_KEY=sk-your-key-here
```

**OpenAI:**

```yaml
provider: openai
base_url: https://api.openai.com/v1
endpoint: /chat/completions
model: gpt-5
api_key_env: OPENAI_API_KEY
```

```env
OPENAI_API_KEY=sk-...
```

**OpenRouter:**

```yaml
provider: openrouter
model: anthropic/claude-sonnet-4
api_key_env: OPENROUTER_API_KEY
```

```env
OPENROUTER_API_KEY=sk-...
```

**Groq:**

```yaml
provider: groq
model: llama-3.3-70b-versatile
api_key_env: GROQ_API_KEY
```

```env
GROQ_API_KEY=sk-...
```

**Ollama (local):**

```yaml
provider: ollama
model: llama3.1
api_key_env: OLLAMA_API_KEY  # optional for local; set any name you like, or rely on the registry URL
```

```env
OLLAMA_API_KEY=sk-...
```

**Custom OpenAI-compatible provider (explicit `base_url`/`endpoint`):**

```yaml
provider: my-company-proxy
base_url: https://llm.gateway.example.com/v1
endpoint: /chat/completions
model: custom-model-1
api_key_env: MY_PROXY_API_KEY
```

```env
MY_PROXY_API_KEY=sk-...
```

**Anthropic:**

```yaml
provider: anthropic
model: claude-sonnet-4-5
api_key_env: ANTHROPIC_API_KEY
```

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

> Anthropic ignores `base_url` and `endpoint` — its Messages API URL is fixed in the client.

**Fallback block (optional; same routing rules as the main block):**

```yaml
fallback:
  provider: deepseek
  base_url: https://api.deepseek.com/v1
  model: deepseek-v4-flash
  api_key_env: DEEPSEEK_API_KEY
```

**Routing rules:**

1. An explicit `base_url` always wins over the built-in provider URL registry.
2. When `base_url` is omitted, the registry entry for `deepseek`/`openai`/`openrouter`/`groq`/`ollama` is used.
3. `endpoint` defaults to `/chat/completions` when omitted.
4. There is **no CLI flag for switching providers** — provider switching is config-file-driven (`agent/config/llm.yaml`) only.

A fuller `.env` template:

```env
DEEPSEEK_API_KEY=sk-your-key-here
# OPENAI_API_KEY=sk-...
# OPENROUTER_API_KEY=sk-...
# GROQ_API_KEY=sk-...
# OLLAMA_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-your-key-here
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
