<!-- ronin:version 2 | ronin:task task-b5feec | ronin:updated 2026-08-13T08:17:44.147Z | ronin:subtask code-st-82c66c -->
# likha 概览

**likha** 是一个用 TypeScript（Node.js）编写的 ReAct CLI 代理，内置可热插拔的角色技能，默认使用 DeepSeek 作为 LLM 提供方。LLM 后端由配置驱动：DeepSeek 是默认提供方，任何与 OpenAI 兼容的提供方或 Anthropic 都可通过编辑 `agent/config/llm.yaml` 并设置对应的 API 密钥环境变量来选择——**无需修改任何代码**。本文档是简体中文文档集的入口。

## 概述

likha 遵循 **ReAct**（Reasoning + Acting）模式：它在循环中思考任务、调用工具获取信息或做出修改、观察结果，并重复这一过程，直到任务完成。它支持多种编排引擎、可热插拔的技能指令、阶段规划、HTTP API 服务器、React UI，以及内置的自愈机制，用于检测代理是否陷入停滞。

版本 0.2.0 内置四个可互换的编排引擎（默认 `react`，以及 `lean`、`langgraph`、`swarm`），并从 `agent/skills/` 加载 30+ 个专业技能。

## 主要功能

- **ReAct 循环** — 搜索 → 行动 → 验证 阶段
- **多引擎实现** — 标准 ReAct、LeanEngine、LangGraph、Swarm
- **可热插拔技能系统** — 30+ 个专业技能（programmer、architect、devops、tester 等），从 `agent/skills/` 加载
- **计划模式（Plan Mode）** — 执行前生成任务计划，并请求用户批准
- **阶段规划（Phase Planning）** — 将复杂任务拆分为顺序阶段，各阶段上下文隔离
- **自愈健康评分** — 检测进展停滞并提示代理回到正轨
- **HTTP API 服务器** — 基于 Express 的 REST API，支持远程执行任务
- **React UI** — 基于 Vite + TypeScript 的前端，用于管理任务、计划和遥测

## 快速开始

请先在环境中或 `.env` 文件中设置 `DEEPSEEK_API_KEY`，然后安装依赖并构建：

```bash
npm run likha:install
npm run build
```

运行第一个任务：

```bash
npm start -- --task "列出 src/ 下的所有 TypeScript 文件"
```

不需要构建步骤？直接使用开发模式运行：

```bash
npm run dev -- --task "列出 src/ 下的所有 TypeScript 文件"
```

## 下一步

- [setup.md](./setup.md) — 前置条件、安装与环境配置
- [usage.md](./usage.md) — CLI 参考、引擎选择与测试
- [blurprint.md](./blurprint.md) — 架构蓝图、核心抽象与扩展点
