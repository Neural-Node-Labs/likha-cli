# xcoder

A ReAct CLI coding agent with a hot-pluggable skill system, a swappable orchestration engine, and
an optional web UI/API layer. DeepSeek is the default LLM provider.

For a deeper look at how the system is put together — the engine/IO abstraction, the scoring model,
the CLI/database boundary, the skill system's routing logic — see **[blueprint.md](./blueprint.md)**.
This file is the "how do I run it" doc; that one is the "how does it work" doc.

## What's here

- **CLI** (`xcoder`) — run one-off tasks, interactive chat, project indexing, deploy automation.
- **Skill system** — `agent/skills/<name>/SKILL.md` files that route to specialized instructions
  based on the task description (role skills like `software-engineer`/`qa-engineer`, and DevOps
  skills like `docker`/`kubernetes`/`aws`/`openshift` — run `xcoder --skills` for the full list).
- **API server + web UI** — an Express API (`src/api/`) and a React UI (`ui/`) for browser-based
  chat, telemetry, plan/phase review, and admin.
- **Swappable engine** — the ReAct loop is one *implementation* of an `IReactEngine` interface;
  the CLI and API both go through an `EngineRegistry` rather than depending on it directly.

## Requirements

- Node.js 18+
- A DeepSeek API key (or an Anthropic key as fallback) — see [Configuration](#configuration)
- Docker, if you plan to use `--deploy --docker` or the provided `docker-compose` setup

## Quick start

> **Note on `npm install`:** `package.json` defines an `install` lifecycle script
> (`scripts/install.sh`) that is **not present in this checkout** — running plain `npm install`
> will fail with `scripts/install.sh: No such file or directory`. Use `--ignore-scripts` until
> that script is restored (see [Known gaps](#known-gaps)).

```bash
# 1. Install dependencies (skip the missing lifecycle script — see note above)
npm install --ignore-scripts

# 2. Configure your LLM key
cp .env.example .env
# edit .env and set DEEPSEEK_API_KEY

# 3. Build
npm run build

# 4. Run a task
node dist/cli/index.js --task "describe what this repository does"

# — or, once installed globally / linked —
xcoder --task "describe what this repository does"
```

### Interactive chat

```bash
xcoder --chat
```

### Indexing a workspace

```bash
xcoder --index          # writes .agent/index/ for the current directory
xcoder --skills         # list every loaded skill, its role, and its triggers
```

## CLI reference

```
xcoder [task]                        run a task (positional arg == --task)
  --task <description>               same as above, explicit form
  --chat                             interactive chat loop
  --index                            index the current workspace
  --skills                           list loaded skills
  --lesson <text>                    record a lesson to tasks/lessons.md

  --plan / --no-plan                 force Plan Mode on/off (default: heuristic)
  --single-phase                     disable phase-based planning, run as one ReAct loop
  --full-context-token               keep every file-read snapshot instead of compacting stale ones
  --isolated-workspace               run tool ops against ./workspace-agent instead of live files
  --auto                             auto-answer every interactive prompt (CI/automation mode)
  --engine <name>                    which registered orchestration engine to use (default: "react")

  --audit-react                      run the built-in bug-fixing scenario battery
  --diagnose-live                    run the 7-point live diagnostic suite against the real LLM

  --serve                            start the HTTP API server
  --port <number> / --host <addr>    API server bind address (default: 3001 / 0.0.0.0)

  --deploy [--docker]                deploy via `docker compose up -d --build`
    --llm true|false                 route the deploy through the LLM/engine (diagnose+fix) vs. direct
    --remote <ip>                    deploy to a remote Docker host over SSH instead of locally
    --remote-path <path>             remote directory (default: /opt/xcoder)
```

`--deploy --docker --remote <ip> --llm true|false` deploys to a remote Docker host over SSH;
`--llm` toggles whether the deploy is agent-mediated (can diagnose and fix a failed build) or a
direct `docker compose` invocation. Remote deploys require `REMOTE_SSH_USER` and
`REMOTE_SSH_PASSWORD` set in `.env`.

## Configuration

All configuration is via environment variables (`.env` — see `.env.example`,
`.env.production.example`, `.env.staging.example` for the full set with comments):

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | Primary LLM provider (required for any task to actually run) |
| `ANTHROPIC_API_KEY` | Optional fallback if DeepSeek is unreachable/unset |
| `GITHUB_TOKEN` | Used by `github_tool` for HTTPS clone/fetch/pull/push auth |
| `XCODER_API_KEY` | If set, all `/api/v1/*` endpoints require `Authorization: Bearer <key>` |
| `XCODER_API_PORT` | API server port (default `3001`) |
| `MAX_ITERATIONS` | ReAct loop iteration ceiling per round — code default is **20** (`orchestrator.ts`); note `.env.example`'s inline comment says 10, which is stale relative to the actual code default |
| `DATABASE_TYPE` | `sqlite` (default, zero-config) or `postgres` |
| `DATABASE_SQLITE_PATH` | Default `~/.xcoder/data/xcoder.db` |
| `DATABASE_URL` / `DATABASE_HOST` etc. | Postgres connection, if `DATABASE_TYPE=postgres` |
| `REMOTE_SSH_USER` / `REMOTE_SSH_PASSWORD` | Required for `--deploy --remote <ip>` |

**CLI runs never touch the database** — they log only to `.log/*.log` (via `FileTelemetry`) and
the markdown files under `tasks/`. Only the API server writes to the database (task history, phase
reports, WBS) — see [blueprint.md § Persistence boundary](./blueprint.md#persistence-boundary) for
why that split exists and how it's enforced in code.

## Running the API + UI

```bash
# API server
xcoder --serve --port 3001

# UI (separate terminal)
cd ui
npm install --ignore-scripts
npm run dev      # dev server, proxies to the API
npm run build    # production build → ui/dist/
```

## Testing

```bash
npm test          # vitest run
npm run test:watch
```

## Docker

```bash
xcoder --deploy --docker              # local: docker compose up -d --build
xcoder --deploy --docker --llm true   # same, but agent-mediated (diagnoses/fixes build failures)
```

A `docker-compose.yml` is expected at the project root for this to work — see
[blueprint.md § Deployment topology](./blueprint.md#deployment-topology).

## Known gaps

These are tracked, not hidden — see `CHANGES.md` for the full history of what's been
fixed/verified so far in this checkout:

- `package.json`'s `install`/`setup`/`package:*` npm scripts reference `scripts/*.sh` files that
  don't exist in this checkout. Use the manual commands in [Quick start](#quick-start) until
  they're restored.
- No top-level `docker-compose.yml` is included in this doc set — add one matching your actual
  services before relying on `--deploy --docker`.

## License

Not yet specified — add a `LICENSE` file before distributing outside your organization.
