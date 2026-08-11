<!-- ronin:version 6 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T17:04:17.148Z | ronin:subtask code-st-d23750 -->
# xcoder — Использование

Как вызывать CLI xcoder, запускать задачи, управлять API-сервером и интерфейсом, выбирать движок оркестрации и запускать тесты.

## Синтаксис CLI

```bash
xcoder [task] [options]
```

Позиционный аргумент `[task]` эквивалентен `--task <description>`. После сборки CLI находится в `dist/cli/index.js`; npm-скрипты и глобальный бинарник `xcoder` оба указывают на него.

Типичные точки входа:

```bash
# Run a task through the built CLI
npm start -- --task "Перечисли все файлы TypeScript в src/"

# Run from source (no build step needed)
npm run dev -- --task "Перечисли все файлы TypeScript в src/"

# Run the built entry point directly
node dist/cli/index.js
```

## Основные команды

Основной исполнитель задач и команды агента работают через позиционный аргумент задачи или `--task`:

```bash
# Positional task (equivalent to --task)
xcoder "Отрефактори модуль аутентификации для использования JWT-токенов"

# Explicit task option with the lean engine
xcoder --engine lean --task "Проанализируй покрытие тестами"

# Interactive chat mode (workspace = current folder)
xcoder --chat

# List all loaded skills and their trigger keywords
xcoder --skills

# Index the current workspace into .agent/index/
xcoder --index

# Record a lesson to tasks/lessons.md
xcoder --lesson "Всегда проверяй пути к файлам перед записью"

# Fully autonomous mode — auto-answers ALL interactive prompts
xcoder --auto --task "Настрой конвейер CI/CD"

# Runtime diagnostics
excoder --audit-react
xcoder --diagnose-live
```

Режим Plan управляется явно:

```bash
# Force Plan Mode on
xcoder --plan --task "Сложная задача"

# Force Plan Mode off
xcoder --no-plan --task "Быстрая задача"

# Run as a single ReAct loop (disable phase planning)
xcoder --single-phase --task "Сложная задача"
```

## API-сервер и интерфейс

### API-сервер

API-сервер на базе Express предоставляет маршруты в `/api/v1` (выполнение задач, планы, телеметрия, навыки, история задач, отчёты о фазах, WBS и управление пользователями):

```bash
# Start the API server on the default port (3001)
xcoder --serve

# Start the API server on an explicit port
xcoder --serve --port 3001

# npm script wrapper for the same command
npm run xcoder:api
```

Порт и хост также могут приходить из окружения:

```env
XCODER_API_PORT=3001
XCODER_API_HOST=0.0.0.0
```

Если `XCODER_API_KEY` задана, все конечные точки `/api/v1/*` (кроме health/login/register/user-count) требуют `Authorization: Bearer <XCODER_API_KEY>`. Если она не задана, API работает без аутентификации и регистрирует предупреждение при запуске.

### Интерфейс

React-интерфейс (Vite + TypeScript) работает вместе с API-сервером:

```bash
# Start both API and UI
xcoder --ui

# npm script wrapper: API on 3001 + UI dev server
npm run xcoder:ui
```

## Выбор движка

xcoder поставляется с четырьмя взаимозаменяемыми движками оркестрации, все реализуют интерфейсы `IReactEngine` / `IReactEngineV2`. Выберите один с помощью `--engine <name>`:

```bash
xcoder --engine <name> --task "Перечисли все файлы TypeScript в src/"
```

| Движок | Имя регистрации | Описание |
|---|---|---|
| **ReActOrchestrator** | `react` (по умолчанию) | Полнофункциональный движок с режимом Plan, поэтапным планированием, делегированием субагентам, проверкой целей и самовосстановлением |
| **LeanEngine** | `lean` | Сфокусированный автономный цикл ReAct; поддерживает жизненный цикл V2 |
| **LangGraphEngine** | `langgraph` | Цикл ReAct на базе StateGraph из `@langchain/langgraph`; поддерживает жизненный цикл V2 |
| **SwarmEngine** | `swarm` | Параллельная оркестрация роем с декомпозицией WBS и конкурентной отправкой агентов |

Движки регистрируются в `src/core/engine/EngineRegistry.ts` с помощью фабричного паттерна. Новые реализации можно добавлять через `registerEngine("name", factory)` — изменения в CLI или API не требуются.

## Тестирование

Запустите полный набор тестов (Vitest):

```bash
npm test
```

Повторно запускайте тесты в режиме наблюдения во время разработки:

```bash
npm run test:watch
```

## Дальнейшие шаги

- [readme.md](./readme.md) — обзор и быстрый старт
- [setup.md](./setup.md) — установка и конфигурация окружения
- [blurprint.md](./blurprint.md) — архитектура и точки расширения
