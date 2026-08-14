<!-- ronin:version 1 | ronin:task task-5e8fe0 | ronin:updated 2026-08-11T16:38:44.515Z | ronin:subtask code-st-be6a3a -->
# likha 使用指南

本文档说明如何调用 likha CLI、运行任务、驱动 API 服务器与 UI、选择编排引擎，以及运行测试与诊断。

## CLI 调用

```bash
likha [task] [options]
```

位置参数 `[task]` 等价于 `--task <description>`。构建之后，CLI 位于 `dist/cli/index.js`；npm 脚本与全局 `likha` 命令都指向该入口。

常用入口方式：

```bash
# 通过构建后的 CLI 运行任务
npm start -- --task "列出 src/ 下的所有 TypeScript 文件"

# 从源码运行（无需构建）
npm run dev -- --task "列出 src/ 下的所有 TypeScript 文件"

# 直接运行构建后的入口
node dist/cli/index.js
```

## 核心命令

主要任务运行器与代理命令通过位置任务参数或 `--task` 工作：

```bash
# 位置任务参数（等价于 --task）
likha "重构认证模块以使用 JWT 令牌"

# 显式任务选项，并使用 lean 引擎
likha --engine lean --task "分析测试覆盖率"

# 交互式聊天空（工作区 = 当前文件夹）
likha --chat

# 列出所有已加载技能及其触发关键词
likha --skills

# 将当前工作区建立索引到 .agent/index/
likha --index

# 记录一条经验到 tasks/lessons.md
likha --lesson "写入文件之前始终校验文件路径"

# 全自动模式 — 自动回答所有交互式提示
likha --auto --task "搭建 CI/CD 流水线"

# 运行时诊断
likha --audit-react
likha --diagnose-live
```

计划模式可以显式控制：

```bash
# 强制启用计划模式
likha --plan --task "复杂任务"

# 强制关闭计划模式
likha --no-plan --task "快速任务"

# 作为单个 ReAct 循环运行（关闭阶段规划）
likha --single-phase --task "复杂任务"
```

### 常用选项

| 选项 | 说明 |
|---|---|
| `--task <description>` | 执行单个任务，必要时先请求澄清 |
| `--chat` | 进入交互式聊天模式（工作区 = 当前文件夹） |
| `--index` | 将当前工作区索引到 `.agent/index/` |
| `--skills` | 列出所有已加载技能及其触发关键词 |
| `--lesson <text>` | 记录经验到 `tasks/lessons.md` |
| `--plan` | 强制启用计划模式 |
| `--no-plan` | 强制关闭计划模式 |
| `--full-context-token` | 保留所有历史 `read_tool` 文件快照，不压缩陈旧上下文；默认关闭（lean-token 压缩开启） |
| `--single-phase` | 关闭阶段规划，作为单个 ReAct 循环运行；默认阶段规划开启 |
| `--auto` | 全自动模式，对所有交互式提示自动回答“是” |
| `--isolated-workspace` | 在隔离的 `./workspace-agent` 副本中运行工具操作；默认关闭 |
| `--engine <name>` | 编排引擎（默认：`react`）。已注册：`react`、`lean`、`langgraph`、`swarm` |
| `--serve` | 启动 likha HTTP API 服务器 |
| `--ui` | 同时启动 API 服务器与 UI 前端 |
| `--port <number>` | API 服务器端口（默认：3001） |
| `--host <address>` | API 服务器主机（默认：0.0.0.0） |
| `--deploy` | 触发部署模式（Docker Compose） |
| `--docker` | 使用 Docker Compose 部署 |
| `--llm <boolean>` | 将部署任务作为 devops 任务发送给 LLM |
| `--remote <ip>` | 远程部署主机 IP |
| `--remote-path <path>` | 远程部署目录（默认：`/opt/likha`） |
| `--audit-react` | 运行内置 bug 修复场景测试集 |
| `--audit-out <path>` | 审计报告 Markdown 输出路径 |
| `--diagnose-live` | 运行 7 项 ReAct 诊断套件（针对真实配置的 LLM） |
| `--diagnose-out <path>` | 诊断报告输出路径 |

## API 与 UI 服务

### API 服务器

基于 Express 的 API 服务器在 `/api/v1` 下提供路由（任务执行、计划、遥测、技能、任务历史、阶段报告、WBS、用户管理）：

```bash
# 在默认端口（3001）启动 API 服务器
likha --serve

# 在显式端口启动 API 服务器
likha --serve --port 3001

# 等价的 npm 脚本
npm run likha:api
```

端口与主机也可以通过环境变量配置：

```env
XCODER_API_PORT=3001
XCODER_API_HOST=0.0.0.0
```

若设置了 `XCODER_API_KEY`，除 health/login/register/user-count 之外的所有 `/api/v1/*` 端点都需要 `Authorization: Bearer <XCODER_API_KEY>`；未设置时 API 无认证运行，并在启动时记录一条警告。

### UI

React UI（Vite + TypeScript）与 API 服务器一起运行：

```bash
# 同时启动 API 与 UI
likha --ui

# npm 脚本包装：API 在 3001 + UI 开发服务器
npm run likha:ui
```

## 引擎选择

likha 内置四个可互换的编排引擎，均实现 `IReactEngine` / `IReactEngineV2` 接口。通过 `--engine <name>` 选择：

```bash
likha --engine <name> --task "列出 src/ 下的所有 TypeScript 文件"
```

| 引擎 | 注册名 | 说明 |
|---|---|---|
| **ReActOrchestrator** | `react`（默认） | 全功能引擎，支持计划模式、阶段规划、子代理委派、目标验证与自愈 |
| **LeanEngine** | `lean` | 聚焦的自包含 ReAct 循环，支持 V2 生命周期 |
| **LangGraphEngine** | `langgraph` | 基于 `@langchain/langgraph` 的 StateGraph 构建的 ReAct 循环，支持 V2 生命周期 |
| **SwarmEngine** | `swarm` | 并行 swarm 编排，带 WBS 分解与并发代理分发 |

引擎在 `src/core/engine/EngineRegistry.ts` 中通过工厂模式注册。可以通过 `registerEngine("name", factory)` 添加新实现，无需修改 CLI 或 API。

## 测试与诊断

运行完整测试套件（Vitest）：

```bash
npm test
```

开发期间以监听模式重跑测试：

```bash
npm run test:watch
```

类型检查：

```bash
npm run typecheck
```

内置 ReAct 审计（bug 修复场景测试集）与实时诊断：

```bash
likha --audit-react
likha --audit-out reports/my-audit.md
likha --diagnose-live
likha --diagnose-out reports/my-diagnostics.md
```

## 下一步

- [readme.md](./readme.md) — 概览与快速开始
- [setup.md](./setup.md) — 安装与环境配置
- [blurprint.md](./blurprint.md) — 架构蓝图与扩展点
