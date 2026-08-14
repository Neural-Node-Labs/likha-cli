<!-- ronin:version 1 | ronin:task task-5e8fe0 | ronin:updated 2026-08-11T16:39:04.678Z | ronin:subtask code-st-be6a3a -->
# likha 架构蓝图

本文档说明 likha 的内部工作原理：设计目标、核心抽象、引擎、技能系统、API 服务器与 UI、部署拓扑、目录参考、扩展点与已知缺口。

## 设计目标

架构围绕四个目标组织：

1. **编排引擎可替换。** ReAct 循环（`ReActOrchestrator`）是 `IReactEngine` 接口的一种实现，而不是 CLI 或 API 的硬编码依赖。
2. **表现层不关心引擎细节。** 引擎通过 `AgentIO` 接口报告进度并请求批准；它不关心自己是在与终端、HTTP 请求还是测试框架对话。
3. **CLI 与数据库解耦。** `likha --task "..."` 运行永远不会打开数据库连接。只有 API 服务器（支撑 UI）向数据库持久化。
4. **行为通过技能扩展，而不是 fork。** 领域知识位于 `agent/skills/*/SKILL.md`，在运行时通过关键词路由选择，而不是编译进核心循环。

## 系统图

```
                         ┌──────────────────────────┐
                         │        IReactEngine        │   src/core/engine/IReactEngine.ts
                         │   (contract: run, plan,     │
                         │  selectSkills, getStatus…) │
                         └────────────┬─────────────┘
                                      │ implemented by
                         ┌────────────▼─────────────┐
                         │      ReActOrchestrator      │   src/core/orchestrator.ts
                         │  (the reference ReAct loop) │
                         └───┬───────────────────┬────┘
               reports via   │                   │  selects
                    ┌────────▼──────┐    ┌───────▼────────┐
                    │    AgentIO      │    │  SkillRegistry   │
                    │ (report/confirm)│    │ (agent/skills/*) │
                    └───┬─────────┬──┘    └─────────────────┘
                        │         │
              ┌─────────▼─┐   ┌───▼──────────┐
              │   CliIO     │   │    AutoIO      │
              │ (terminal,  │   │ (headless-safe, │
              │  readline)  │   │  never touches   │
              │             │   │  stdin; console  │
              │             │   │  logging only)   │
              └─────┬──────┘   └───────┬────────┘
                    │                   │
        ┌───────────▼──────┐  ┌────────▼─────────────┐
        │   src/cli/index.ts │  │  src/api/routes.ts     │
        │  (uses CliIO,      │  │  (uses AutoIO default, │
        │   EngineRegistry)  │  │   sets persistToDb:true)│
        └───────────┬──────┘  └────────┬─────────────┘
                    │                   │
         .log/*.log, tasks/*.md   .log/*.log, tasks/*.md,
         (file-only, always)      + database (task history,
                                    phase reports, WBS)
                                            │
                                   ┌────────▼────────┐
                                   │   ui/ (React)     │
                                   │ reads via the API  │
                                   └───────────────────┘
```

## 核心抽象

### `IReactEngine`（`src/core/engine/IReactEngine.ts`）

每个编排引擎必须实现的最小契约：`run()`、`generatePlan()`、`selectSkills()`，以及状态读取方法（`getLastOutcome`、`getCumulativeUsage`、`getHealthScore`、`getPartialSuccess`、`getSubagentLimitContext`）。`src/core/engine/` 之外不应直接导入 `ReActOrchestrator`，而应通过注册表访问。

### `EngineRegistry`（`src/core/engine/EngineRegistry.ts`）

引擎通过工厂模式按名称注册：

```ts
registerEngine("react", (deps) => new ReActOrchestrator(deps.llm, deps.telemetry, { ...deps.options, io: deps.io }));
```

### `AgentIO`（`src/core/io/AgentIO.ts`）

分为 `AgentReporter`（单向：`log`、`thought`、`action`、`observation`、`usage`、`spinnerStart`/`spinnerStop` 等）和 `AgentPrompter`（`confirm(message, opts)` — 唯一的双向调用，用于计划批准和迭代上限续跑）。

内置两种实现：

- **`CliIO`**（`src/cli/CliIO.ts`）— ANSI 彩色终端报告、spinner、以及基于 `readline` 的 stdin 提示。它位于 `src/cli/`，不在引擎内。
- **`AutoIO`**（`src/core/io/AutoIO.ts`）— 默认实现。向 console 记录日志以保持可见性，但**从不读取 stdin**；`confirm()` 使用默认值立即 resolve。这让引擎可以安全地在 API 请求处理中运行——无头运行绝不会因等待无人回答的提示而挂起。

## ReAct 循环与计分模型

每个完成的工具步骤由 `scoreStep`（`src/core/stepScorer.ts`）打 0–100 分：

- 基线 **70**。
- 无错误：**+10**；有错误：**−45**。
- 完全重复的动作（相同工具 + 相同参数 + 与之前某一步相同的观察结果）：**−35**。合法重跑（中间状态发生了变化）不触发扣分。
- 成功的 `write_edit_tool` 或 `run_command_tool` 调用：**+10** 奖励（具体的前进进展，而不是只读调查）。

`rollingHealth()` 平均最近 5 个已计分步骤。若平均值低于 **40**（至少 2 个分数，且距上次告警有冷却期），编排器会注入一条自检消息，提示自己重新读取状态、验证上一个假设并尝试不同方法。

对于非平凡任务，引擎会在执行前起草计划（写入 `tasks/todo.md`），并视拆分价值生成阶段分解（`tasks/wbs.md`）——每个阶段作为隔离的子 `ReActOrchestrator` 运行，拥有独立的健康跟踪与迭代预算，因此早期错误假设不会污染后一阶段的上下文。计划与阶段计划都通过 `AgentIO.confirm()` 请求批准。

## 引擎列表

| 引擎 | 注册名 | 说明 |
|---|---|---|
| **ReActOrchestrator** | `react`（默认） | 全功能引擎，支持计划模式、阶段规划、子代理委派、目标验证与自愈 |
| **LeanEngine** | `lean` | 聚焦的自包含 ReAct 循环；支持 V2 生命周期 |
| **LangGraphEngine** | `langgraph` | 基于 `@langchain/langgraph` 的 StateGraph，显式两节点状态机（agent ↔ tools）；支持 V2 生命周期 |
| **SwarmEngine** | `swarm` | 并行 swarm 编排，带 WBS 分解与并发代理分发；支持 V2 生命周期 |

也可以编程方式创建引擎：

```ts
const engine = createEngine("lean", { llm, telemetry, io, options });
console.log(listEngines()); // ["react", "lean", "langgraph", "swarm"]
```

## 技能系统

`SkillRegistry`（`src/core/skillRegistry.ts`）加载所有 `agent/skills/<name>/SKILL.md`：

```yaml
---
name: kebab-case-id       # unique
role: short-noun-phrase
description: one sentence
triggers: ["phrase one", "phrase two"]   # lowercase substrings, matched against the lowercased task
version: "1.0.0"
requires_tools: [tool_name, ...]
composes_with: [other-skill-name, ...]
---
markdown body (Process / Instructions / Strategies / Experience)
```

`route(taskDescription)` 将任务转小写，并统计每个技能的触发词有多少个字面子串出现在任务中。**这是不带词边界的纯子串匹配** — `"ux"` 会匹配到 `"SELinux"`，`"pod"` 会匹配到 `"podcast"`，`"git"` 会匹配到 `"digital"`。因此触发词必须防御性地设计（更长的短语，或显式的尾随空格边界，如 `"the pod "`）。

运行 `likha --skills` 可查看带角色与触发词的活动技能列表。

## 持久化边界

`OrchestratorOptions.persistToDb`（默认 `false`）控制引擎内所有数据库写入（`TaskHistoryStore`、`PhaseReportStore`、`WbsStore` — 均位于 `src/api/*Store.ts`，每个按 `DATABASE_TYPE` 由 SQLite 或 Postgres 支撑）。基于文件与 console 的日志（`.log/` 下的 `FileTelemetry`，以及 `tasks/*.md`）是无条件的，无论该标志如何都始终发生。

- `src/cli/index.ts` 从不设置 `persistToDb` → CLI 运行只写文件。
- `src/api/routes.ts` 构造引擎时总是传入 `persistToDb: true` → UI 读取的数据（任务历史、阶段报告、WBS）只来自 API 驱动的运行。

子编排器（阶段、子代理）继承 `persistToDb`，因为每个派生点都把 `...this.opts` 展开到子选项里。

## API 服务器与 UI

- Express 服务器（`src/api/server.ts`），路由挂载在 `/api/v1`（`src/api/routes.ts`）。关键端点：`/chat`（运行任务）、`/chat/plan` + `/chat/execute`（UI 的两阶段计划批准）、`/telemetry`、`/skills`、`/task-history`、`/phase-reports`、`/wbs`、`/settings/llm-key`，以及认证相关（`/login`、`/logout`、`/register`、`/users`）。
- 可选 Bearer Token 认证：`XCODER_API_KEY` — 未设置时 API 无认证运行，并输出启动警告。
- React UI（`ui/`）— 设计令牌与共享原语（`Card`、`Button`、`Badge`、`PageHeader`）位于 `ui/src/index.css` 与 `ui/src/components/ui/`。页面直接消费 API，没有服务端渲染层。

## 部署拓扑

`likha --deploy --docker [--remote <ip>] [--llm true|false]`：

- 无 `--remote`：本地 `docker compose up -d --build` — 直接执行，或（`--llm true`）把同一目标交给引擎作为 devops 任务诊断并修复失败的构建。
- `--remote <ip>`：SSH 到远程主机（使用 `.env` 中的 `REMOTE_SSH_USER`/`REMOTE_SSH_PASSWORD`），在那里部署；`--remote-path` 默认 `/opt/likha`。

## 目录参考

```
src/
  core/          ReAct 引擎、engine/IO 抽象、计分、技能注册表、协议/计划模式
  cli/           CLI 入口、CliIO（终端表现）
  api/           Express 服务器、路由、数据库存储（任务历史 / 阶段报告 / WBS）
  db/            数据库连接、迁移、初始化
  tools/         工具 schema + 分发器
  llm/           LLM 客户端 — DeepSeek 主用、Anthropic 备用
  telemetry/     FileTelemetry（始终开启）+ Postgres 遥测（仅 API）
  config/        环境/配置加载
  indexing/      工作区索引，用于 .agent/index/
  remote/        远程 SSH 部署支持
agent/
  skills/        SKILL.md 文件 — 参见“技能系统”
  config/        LLM 提供方配置（llm.yaml）
ui/
  src/           React 应用（页面、components/ui 原语、context、API 客户端）
tasks/           运行时输出：todo.md、wbs.md、lessons.md、阶段报告（实践中被 git 忽略）
.log/            运行时输出：FileTelemetry 日志（实践中被 git 忽略）
```

## 扩展点

- **新引擎** — 实现 `IReactEngine`，然后调用 `registerEngine("name", factory)`；参见 `EngineRegistry.ts` 自己注册 `"react"` 的模板。
- **新技能** — 添加 `agent/skills/<name>/SKILL.md`；schema 与触发词安全规则参见 `skill-authoring` 技能。
- **新工具** — 在 `toolSchemas.ts` 添加 schema 条目，在 `toolDispatcher.ts` 添加分发 case。
- **新 IO 后端**（例如未来的 TUI 或 WebSocket 流式 API 模式）— 实现 `AgentIO`。

## 已知缺口

- `package.json` 引用了本检出中不存在的 `scripts/*.sh`；README 中的手工命令可工作，但这些脚本本身需要编写。
- 尽管存在 `--deploy --docker` 与 `docker_compose_deploy_tool`，仓库并未附带 `docker-compose.yml`/`Dockerfile`。
- `.env.example` 中 `MAX_ITERATIONS` 的注释默认值是 10，而代码默认是 20。

## 下一步

- [readme.md](./readme.md) — 概览与快速开始
- [setup.md](./setup.md) — 安装与环境配置
- [usage.md](./usage.md) — CLI 参考、引擎选择与测试
