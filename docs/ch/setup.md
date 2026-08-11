<!-- ronin:version 1 | ronin:task task-5e8fe0 | ronin:updated 2026-08-11T16:38:32.329Z | ronin:subtask code-st-be6a3a -->
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
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（真实 LLM 运行必需） |
| `DEEPSEEK_BASE_URL` | DeepSeek API 基础 URL |
| `DEEPSEEK_MODEL` | 模型名称（默认：`deepseek-chat`） |
| `ANTHROPIC_API_KEY` | 可选备用提供方，仅在 DeepSeek 不可用/未设置时使用 |
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

注意：`MAX_ITERATIONS` 在 `.env.example` 的注释中写为默认 10，但代码默认值是 20；本文档将该变量作为覆盖选项说明，不断言具体默认值。

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
