<!-- ronin:version 5 | ronin:task task-b5feec | ronin:updated 2026-08-13T08:18:47.078Z | ronin:subtask code-st-82c66c -->
# likha — Pag-setup

Gabay ito sa pag-install ng likha, pag-configure ng environment nito, pag-initialize ng database, at pag-setup ng development workflow.

## Mga Kinakailangan

- **Node.js >= 18**
- **npm** (kailangan para sa UI dependencies)
- **DeepSeek API key** — i-set ang `DEEPSEEK_API_KEY` sa iyong environment o sa `.env` file

## Pag-install

I-install ang mga dependencies mula sa project root (kasama nito ang pag-install ng `ui/` frontend dependencies):

```bash
npm run likha:install
```

Pagkatapos ay i-build ang TypeScript sources (kinokopya rin ng `build` script ang `agent/` config directory papunta sa `dist/config/`):

```bash
npm run build
```

Pagkatapos mag-build, ang CLI ay makikita sa `dist/cli/index.js` at maaaring patakbuhin gamit ang `npm start -- --task "..."`.

## Configuration ng Environment

Gumawa ng `.env` file sa project root. Ang minimal na configuration ay ang DeepSeek API key:

```env
DEEPSEEK_API_KEY=sk-your-key-here
```

Ang mga sumusunod na environment variables ay suportado:

| Variable | Layunin |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key (default provider — kinakailangan para sa default runs) |
| `OPENAI_API_KEY` | OpenAI API key (tingnan ang `provider: openai` sa ibaba) |
| `OPENROUTER_API_KEY` | OpenRouter API key (tingnan ang `provider: openrouter` sa ibaba) |
| `GROQ_API_KEY` | Groq API key (tingnan ang `provider: groq` sa ibaba) |
| `OLLAMA_API_KEY` | Ollama API key — opsyonal para sa lokal; maaaring mag-set ng anumang pangalan |
| `ANTHROPIC_API_KEY` | Anthropic API key — fallback, o paglipat sa pamamagitan ng `provider: anthropic` sa `agent/config/llm.yaml` |
| `GITHUB_TOKEN` | Token para sa `github_tool` HTTPS auth (clone/fetch/pull/push); ipinapasa lamang bilang in-memory auth header |
| `XCODER_API_KEY` | API server bearer-token auth; kung hindi naka-set, ang API ay tatakbo nang walang authentication |
| `XCODER_API_PORT` | Port ng API server (default: 3001) |
| `XCODER_API_HOST` | Host ng API server (default: 0.0.0.0) |
| `MAX_ITERATIONS` | Ceiling ng ReAct loop iterations bawat round |
| `XCODER_RESTRICT_TO_WORKSPACE` | Safety rail: tinatanggihan ang `read_tool`/`write_edit_tool` paths sa labas ng working directory |
| `DATABASE_TYPE` | Database backend: `sqlite` (default) o `postgres` |
| `DATABASE_SQLITE_PATH` | Path sa SQLite database file (default: `~/.likha/data/likha.db`) |
| `DATABASE_URL` | PostgreSQL connection string (na-override nito ang mga indibidwal na params sa ibaba) |
| `DATABASE_HOST` | PostgreSQL host |
| `DATABASE_PORT` | PostgreSQL port |
| `DATABASE_NAME` | Pangalan ng PostgreSQL database |
| `DATABASE_USER` | PostgreSQL user |
| `DATABASE_PASSWORD` | PostgreSQL password |
| `DATABASE_SSL` | Pag-enable ng PostgreSQL SSL |
| `DATABASE_POOL_MAX` | PostgreSQL pool max connections |
| `DATABASE_POOL_IDLE` | PostgreSQL pool idle timeout (ms) |
| `DATABASE_POOL_TIMEOUT` | PostgreSQL pool acquire timeout (ms) |
| `REMOTE_SSH_USER` | SSH user para sa remote deploy |
| `REMOTE_SSH_PASSWORD` | SSH password para sa remote deploy |
| `XCODER_SSH_TARGETS` | Fleet SSH targets (`host1:22,host2:22`) |
| `XCODER_SSH_USER` | Fleet SSH user |
| `XCODER_SSH_PASSWORD` | Fleet SSH password |

Isang mas kumpletong `.env` template:

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
# DATABASE_URL=postgresql://user:pass@localhost:5432/likha
# REMOTE_SSH_USER=deploy
# REMOTE_SSH_PASSWORD=your-password
# XCODER_SSH_TARGETS=host1:22,host2:22
# XCODER_SSH_USER=fleet-user
# XCODER_SSH_PASSWORD=fleet-password
```

### LLM Providers

Ang LLM backend ng likha ay config-driven: **ang DeepSeek ang default provider**, ngunit sinumang OpenAI-compatible provider (OpenAI, OpenRouter, Groq, Ollama, company proxy, …) at ang Anthropic ay maaaring piliin sa pamamagitan ng pag-edit ng `agent/config/llm.yaml` — **walang code changes** at walang CLI flag para sa paglipat ng provider (ang paglipat ng provider ay sa pamamagitan lamang ng config file).

Ang mga key ay hindi kailanman inilalagay sa YAML: ang field na `api_key_env` ay nagpapangalan ng environment variable na may hawak ng key. I-set nang eksakto ang variable na iyon (sa iyong environment o sa `.env` file), at pagkatapos i-edit ang `agent/config/llm.yaml`, i-restart ang anumang tumatakbong likha process.

**Paglipat sa isang OpenAI-compatible provider (halimbawa: OpenAI):**

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

**Paglipat sa Anthropic (hindi nito pinapansin ang `base_url` at `endpoint`):**

```yaml
provider: anthropic
model: claude-sonnet-4-5
api_key_env: ANTHROPIC_API_KEY
```

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Routing rules:

1. Ang explicit na `base_url` ay laging panalo laban sa built-in registry.
2. Kung hindi naka-set ang `base_url`, ginagamit ang registry URL para sa mga kilalang provider (`deepseek`, `openai`, `openrouter`, `groq`, `ollama`).
3. Ang `endpoint` default ay `/chat/completions` kapag hindi naka-set.
4. Hindi pinapansin ng `anthropic` ang `base_url` at `endpoint`.

> Ang `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` ay legacy variables at **hindi binabasa** ng likha.

## Initialization ng Database

Ang SQLite ay ang zero-config default. Para magamit ang database-backed stores (task history, phase reports, WBS, telemetry), i-initialize ang schema:

```bash
npm run init-db
```

Para sa PostgreSQL, i-set ang `DATABASE_TYPE=postgres` at isang `DATABASE_URL` (o ang mga indibidwal na `DATABASE_*` parameters) bago patakbuhin ang `npm run init-db`.

## Development Setup

Patakbuhin mula sa source nang walang build step:

```bash
npm run dev -- --task "List all TypeScript files in src/"
```

Patakbuhin ang test suite:

```bash
npm test
```

Watch mode para sa mga test:

```bash
npm run test:watch
```

Mayroon ding mga interactive setup helpers:

```bash
npm run setup
npm run setup:non-interactive
```

## Mga Susunod na Hakbang

- [readme.md](./readme.md) — pangkalahatang-ideya at mabilisang pagsisimula
- [usage.md](./usage.md) — CLI reference, pagpili ng engine, at pagte-test
- [blurprint.md](./blurprint.md) — architecture blueprint
