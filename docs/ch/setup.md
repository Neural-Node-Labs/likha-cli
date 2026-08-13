<!-- ronin:version 5 | ronin:task task-b5feec | ronin:updated 2026-08-13T08:18:42.400Z | ronin:subtask code-st-82c66c -->
# xcoder 安装与配置

本文档说明如何安装 xcoder、配置环境变量、初始化数据库，以及搭建开发工作流。

## 前置条件

- **Node.js >= 18**
- **npm**（UI 依赖需要）
- **DeepSeek API 密钥** — 在环境中或 `.env` 文件中设置 `DEEPSEEK_API_KEY`

## 安装

在项目根目录安装依赖（该命令也会安装 `ui/` 前端依赖）：

```bash
npm run xcoder:install
```

然后构建 TypeScript 源码（`build` 脚本还会把 `agent/` 配置目录复制到 `dist/config/`）：

```bash
npm run build
```

构建完成后，CLI 位于 `dist/cli/index.js`，可以通过 `npm start -- --task "..."` 运行。

## 环境变量与配置

在项目根目录创建 `.env` 文件，最小配置是 DeepSeek API 密钥：

```env
DEEPSEEK_API_KEY=sk-your-key-here
```

支持的环境变量如下：

| 变量 | 用途 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（默认提供方——默认运行必需） |
| `OPENAI_API_KEY` | OpenAI API 密钥（见下方 `provider: openai`） |
| `OPENROUTER_API_KEY` | OpenRouter API 密钥（见下方 `provider: openrouter`） |
| `GROQ_API_KEY` | Groq API 密钥（见下方 `provider: groq`） |
| `OLLAMA_API_KEY` | Ollama API 密钥——本地使用可选；可设任意名称 |
| `ANTHROPIC_API_KEY` | Anthropic API 密钥——备用，或在 `agent/config/llm.yaml` 中设置 `provider: anthropic` 切换 |
| `GITHUB_TOKEN` | 用于 `github_tool` HTTPS 认证（clone/fetch/pull/push）；仅以内存认证头形式传递 |
| `XCODER_API_KEY` | API 服务器 Bearer Token 认证；未设置时 API 无认证运行 |
| `XCODER_API_PORT` | API 服务器端口（默认：3001） |
| `XCODER_API_HOST` | API 服务器主机（默认：0.0.0.0） |
| `MAX_ITERATIONS` | 每轮 ReAct 循环迭代上限 |
| `XCODER_RESTRICT_TO_WORKSPACE` | 安全护栏：拒绝 `read_tool`/`write_edit_tool` 访问工作目录之外的路径 |
| `DATABASE_TYPE` | 数据库后端：`sqlite`（默认）或 `postgres` |
| `DATABASE_SQLITE_PATH` | SQLite 数据库文件路径（默认：`~/.xcoder/data/xcoder.db`） |
| `DATABASE_URL` | PostgreSQL 连接字符串（覆盖下方独立参数） |
| `DATABASE_HOST` | PostgreSQL 主机 |
| `DATABASE_PORT` | PostgreSQL 端口 |
| `DATABASE_NAME` | PostgreSQL 数据库名 |
| `DATABASE_USER` | PostgreSQL 用户名 |
| `DATABASE_PASSWORD` | PostgreSQL 密码 |
| `DATABASE_SSL` | 是否启用 PostgreSQL SSL |
| `DATABASE_POOL_MAX` | PostgreSQL 连接池最大连接数 |
| `DATABASE_POOL_IDLE` | PostgreSQL 连接池空闲超时（毫秒） |
| `DATABASE_POOL_TIMEOUT` | PostgreSQL 连接池获取超时（毫秒） |
| `REMOTE_SSH_USER` | 远程部署的 SSH 用户 |
| `REMOTE_SSH_PASSWORD` | 远程部署的 SSH 密码 |
| `XCODER_SSH_TARGETS` | 集群 SSH 目标（`host1:22,host2:22`） |
| `XCODER_SSH_USER` | 集群 SSH 用户 |
| `XCODER_SSH_PASSWORD` | 集群 SSH 密码 |

更完整的 `.env` 模板：

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

注意：`MAX_ITERATIONS` 在 `.env.example` 的注释中写为默认 10，但代码默认值是 20；本文档将该变量作为覆盖选项说明，不断言具体默认值。

### LLM 提供方

xcoder 的 LLM 后端完全由配置驱动：**DeepSeek 是默认提供方**，但任何与 OpenAI 兼容的提供方（OpenAI、OpenRouter、Groq、Ollama、公司代理等）以及 Anthropic 都可以通过编辑 `agent/config/llm.yaml` 来切换——**无需修改任何代码**，也没有用于切换提供方的 CLI 标志（切换提供方只能通过配置文件完成）。

密钥绝不内联写入 YAML；`api_key_env` 字段指定存放密钥的环境变量名称。请精确设置该变量（在环境中或 `.env` 文件中），编辑完 `agent/config/llm.yaml` 后重启任何正在运行的 xcoder 进程。

**切换到与 OpenAI 兼容的提供方（以 OpenAI 为例）：**

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

**切换到 Anthropic（忽略 `base_url` 和 `endpoint`）：**

```yaml
provider: anthropic
model: claude-sonnet-4-5
api_key_env: ANTHROPIC_API_KEY
```

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

路由规则：

1. 显式 `base_url` 始终优先于内置注册表。
2. 省略 `base_url` 时，使用已知提供方的注册表 URL（`deepseek`、`openai`、`openrouter`、`groq`、`ollama`）。
3. 省略 `endpoint` 时默认为 `/chat/completions`。
4. `anthropic` 会忽略 `base_url` 和 `endpoint`。

> `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` 是旧版变量，xcoder **不会读取**它们。

## 数据库初始化

SQLite 是零配置的默认后端。要使用数据库存储（任务历史、阶段报告、WBS、遥测），请初始化表结构：

```bash
npm run init-db
```

使用 PostgreSQL 时，请在运行 `npm run init-db` 之前设置 `DATABASE_TYPE=postgres` 以及 `DATABASE_URL`（或各个 `DATABASE_*` 参数）。

## 开发环境

无需构建步骤，直接从源码运行：

```bash
npm run dev -- --task "列出 src/ 下的所有 TypeScript 文件"
```

运行测试套件：

```bash
npm test
```

测试监听模式：

```bash
npm run test:watch
```

也可以使用交互式安装辅助命令：

```bash
npm run setup
npm run setup:non-interactive
```

## 下一步

- [readme.md](./readme.md) — 概览与快速开始
- [usage.md](./usage.md) — CLI 参考、引擎选择与测试
- [blurprint.md](./blurprint.md) — 架构蓝图
