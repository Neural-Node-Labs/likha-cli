<!-- ronin:version 1 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T17:00:09.050Z | ronin:subtask code-st-d23750 -->
# likha — Архитектура

Как likha работает внутри: цели проектирования, основные абстракции, движки, система навыков, API-сервер и интерфейс, топология развёртывания, справочник по каталогам и точки расширения.

## Цели проектирования

Архитектура организована вокруг четырёх целей:

1. **Движок оркестрации заменяем.** Цикл ReAct (`ReActOrchestrator`) — это одна из реализаций интерфейса `IReactEngine`, а не жёстко заданная зависимость CLI или API.
2. **Презентация не касается движка.** Движок сообщает о прогрессе и запрашивает одобрение через интерфейс `AgentIO`; он понятия не имеет, говорит ли с терминалом, HTTP-запросом или тестовой обвязкой.
3. **CLI и база данных развязаны.** Запуск `likha --task "..."` никогда не открывает соединение с базой данных. Только API-сервер (который обслуживает интерфейс) сохраняет данные в базу.
4. **Поведение расширяется навыками, а не форками.** Экспертиза домена живёт в `agent/skills/*/SKILL.md` и выбирается во время выполнения по ключевым словам, а не компилируется в основной цикл.

## Схема системы

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

## Основные абстракции

### `IReactEngine` (`src/core/engine/IReactEngine.ts`)

Минимальный контракт, который должен реализовать каждый движок оркестрации: `run()`, `generatePlan()`, `selectSkills()`, плюс геттеры состояния (`getLastOutcome`, `getCumulativeUsage`, `getHealthScore`, `getPartialSuccess`, `getSubagentLimitContext`). Ничто за пределами `src/core/engine/` не должно импортировать `ReActOrchestrator` напрямую — вместо этого используйте реестр.

### `EngineRegistry` (`src/core/engine/EngineRegistry.ts`)

Движки регистрируются по имени через фабричный паттерн:

```ts
registerEngine("react", (deps) => new ReActOrchestrator(deps.llm, deps.telemetry, { ...deps.options, io: deps.io }));
```

Для выбора движка достаточно `registerEngine("your-name", factory)` — изменения в CLI/API не нужны.

### `AgentIO` (`src/core/io/AgentIO.ts`)

`AgentIO` разделяется на `AgentReporter` (односторонний: `log`, `thought`, `action`, `observation`, `usage`, `spinnerStart`/`spinnerStop`) и `AgentPrompter` (`confirm(message, opts)` — единственный двусторонний вызов, используемый для одобрения плана и продолжения после лимита итераций).

Поставляются две реализации:

- **`CliIO`** (`src/cli/CliIO.ts`) — вывод в терминал с ANSI-цветами, спиннер и настоящие `readline`-приглашения на stdin. Именно здесь живёт «функциональность CLI»; она не является частью движка.
- **`AutoIO`** (`src/core/io/AutoIO.ts`) — реализация по умолчанию. Пишет в консоль для видимости, но **никогда не читает stdin**; `confirm()` сразу возвращает значение по умолчанию. Именно это позволяет движку безопасно работать внутри обработчика запросов API — безголовый запуск никогда не зависнет в ожидании приглашения, на которое никто не ответит.

## Движки

Все четыре движка реализуют `IReactEngine` / интерфейс жизненного цикла V2 (`cancel`, `onProgress`, `getState`, `getLastMessages`, `getWorkspacePath`, `getIterationCount`):

| Движок | Имя регистрации | Описание |
|---|---|---|
| **ReActOrchestrator** | `react` (по умолчанию) | Полнофункциональный движок с режимом Plan, поэтапным планированием, делегированием субагентам, проверкой целей и самовосстановлением |
| **LeanEngine** | `lean` | Сфокусированный автономный цикл ReAct — основной цикл без режима Plan и субагентов. Поддерживает жизненный цикл V2 |
| **LangGraphEngine** | `langgraph` | Цикл ReAct на базе StateGraph из `@langchain/langgraph` с явной машиной состояний из двух узлов (агент ↔ инструменты). Поддерживает жизненный цикл V2 |
| **SwarmEngine** | `swarm` | Параллельная оркестрация роем с декомпозицией WBS и конкурентной отправкой агентов. Поддерживает жизненный цикл V2 |

Движки также можно создавать программно:

```ts
const engine = createEngine("lean", { llm, telemetry, io, options });
console.log(listEngines()); // ["react", "lean", "langgraph", "swarm"]
```

## Система навыков

`SkillRegistry` (`src/core/skillRegistry.ts`) загружает каждый `agent/skills/<name>/SKILL.md`:

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

`route(taskDescription)` приводит задачу к нижнему регистру и подсчитывает, сколько триггеров являются буквальными подстроками задачи. **Это чистое сопоставление подстрок без границ слов** — триггер вроде `"ux"` совпадает внутри `"SELinux"`, `"pod"` совпадает внутри `"podcast"`, а `"git"` совпадает внутри `"digital"`. Поэтому триггеры нужно выбирать защитно (более длинные фразы или явные границы в виде завершающего пробела, например `"the pod "`).

Запустите `likha --skills`, чтобы увидеть живой список навыков с ролями и триггерами.

## API-сервер и интерфейс

- Express-сервер (`src/api/server.ts`) с маршрутами, смонтированными в `/api/v1` (`src/api/routes.ts`). Ключевые конечные точки: `/chat` (выполнить задачу), `/chat/plan` + `/chat/execute` (двухфазное одобрение плана для интерфейса), `/telemetry`, `/skills`, `/task-history`, `/phase-reports`, `/wbs`, `/settings/llm-key`, плюс аутентификация (`/login`, `/logout`, `/register`, `/users`).
- Необязательная аутентификация по Bearer-токену через `XCODER_API_KEY` — если не задана, API работает без аутентификации с предупреждением при запуске.
- React-интерфейс (`ui/`) — дизайн-токены и общие примитивы (`Card`, `Button`, `Badge`, `PageHeader`) живут в `ui/src/index.css` и `ui/src/components/ui/`. Страницы потребляют API напрямую; слоя серверного рендеринга нет.

## Топология развёртывания

`likha --deploy --docker [--remote <ip>] [--llm true|false]`: 

- **Без `--remote`:** локальный `docker compose up -d --build` — напрямую или, с `--llm true`, передаётся движку как devops-задача, чтобы он мог диагностировать и исправить неудачную сборку.
- **С `--remote <ip>`:** подключается по SSH к удалённому хосту (`REMOTE_SSH_USER`/`REMOTE_SSH_PASSWORD` из `.env`) и развёртывает там вместо этого; `--remote-path` по умолчанию — `/opt/likha`.

## Справочник по каталогам

```
src/
  core/          ReAct engine, engine/IO abstractions, scoring, skill registry, protocol/plan mode
  cli/           CLI entrypoint, CliIO (terminal presentation)
  api/           Express server, routes, DB-backed stores (task history / phase reports / WBS)
  db/            Database connection, migrations, init
  tools/         Tool schemas + dispatcher
  llm/           LLM client(s) — DeepSeek primary, Anthropic fallback
  telemetry/     FileTelemetry (always-on) + Postgres telemetry (API-only)
  config/        Env/config loading
  indexing/      Workspace indexing for .agent/index/
  remote/        Remote SSH deploy support
agent/
  skills/        SKILL.md files — see Skill System
  config/        LLM provider config (llm.yaml)
ui/
  src/           React app (pages, components/ui primitives, context, API client)
tasks/           Runtime output: todo.md, wbs.md, lessons.md, phase reports (git-ignored in practice)
.log/            Runtime output: FileTelemetry logs (git-ignored in practice)
```

## Точки расширения

- **Новый движок** — реализуйте `IReactEngine`, затем `registerEngine("name", factory)`; смотрите регистрацию `"react"` самим `EngineRegistry.ts` как шаблон.
- **Новый навык** — добавьте `agent/skills/<name>/SKILL.md`; смотрите навык `skill-authoring` для схемы и правил безопасности триггеров.
- **Новый инструмент** — добавьте запись схемы в `toolSchemas.ts` и ветку в `toolDispatcher.ts`.
- **Новый бэкенд ввода-вывода** (например, будущая TUI или режим API с потоковой передачей через WebSocket) — реализуйте `AgentIO`.

## Дальнейшие шаги

- [readme.md](./readme.md) — обзор и быстрый старт
- [setup.md](./setup.md) — установка и конфигурация окружения
- [usage.md](./usage.md) — справочник CLI, выбор движка и тестирование
