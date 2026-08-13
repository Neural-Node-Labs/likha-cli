<!-- ronin:version 5 | ronin:task task-b5feec | ronin:updated 2026-08-13T08:18:49.257Z | ronin:subtask code-st-82c66c -->
# xcoder — Установка

Как установить xcoder, настроить его окружение, инициализировать базу данных и организовать рабочий процесс разработки.

## Предварительные требования

- **Node.js >= 18**
- **npm** (требуется для зависимостей интерфейса)
- **Ключ API DeepSeek** — задайте `DEEPSEEK_API_KEY` в вашем окружении или в файле `.env`

## Установка

Установите зависимости из корня проекта (это также устанавливает зависимости фронтенда `ui/`):

```bash
npm run xcoder:install
```

Затем соберите исходники TypeScript (скрипт `build` также копирует каталог конфигурации `agent/` в `dist/config/`):

```bash
npm run build
```

После сборки CLI доступен в `dist/cli/index.js` и может быть запущен с помощью `npm start -- --task "..."`.

## Конфигурация окружения

Создайте файл `.env` в корне проекта. Минимальная конфигурация — это ключ API DeepSeek:

```env
DEEPSEEK_API_KEY=sk-your-key-here
```

Поддерживаются следующие переменные окружения:

| Переменная | Назначение |
|---|---|
| `DEEPSEEK_API_KEY` | Ключ API DeepSeek (поставщик по умолчанию — требуется для запусков по умолчанию) |
| `OPENAI_API_KEY` | Ключ API OpenAI (см. `provider: openai` ниже) |
| `OPENROUTER_API_KEY` | Ключ API OpenRouter (см. `provider: openrouter` ниже) |
| `GROQ_API_KEY` | Ключ API Groq (см. `provider: groq` ниже) |
| `OLLAMA_API_KEY` | Ключ API Ollama — необязателен для локального использования; можно задать любое имя |
| `ANTHROPIC_API_KEY` | Ключ API Anthropic — запасной вариант или переключение через `provider: anthropic` в `agent/config/llm.yaml` |
| `GITHUB_TOKEN` | Токен для HTTPS-аутентификации `github_tool` (clone/fetch/pull/push); передаётся только как заголовок аутентификации в памяти |
| `XCODER_API_KEY` | Аутентификация сервера API по Bearer-токену; если не задана, API работает без аутентификации |
| `XCODER_API_PORT` | Порт сервера API (по умолчанию: 3001) |
| `XCODER_API_HOST` | Хост сервера API (по умолчанию: 0.0.0.0) |
| `MAX_ITERATIONS` | Потолок итераций цикла ReAct за раунд |
| `XCODER_RESTRICT_TO_WORKSPACE` | Предохранитель: отклоняет пути `read_tool`/`write_edit_tool` за пределами рабочего каталога |
| `DATABASE_TYPE` | Бэкенд базы данных: `sqlite` (по умолчанию) или `postgres` |
| `DATABASE_SQLITE_PATH` | Путь к файлу базы данных SQLite (по умолчанию: `~/.xcoder/data/xcoder.db`) |
| `DATABASE_URL` | Строка подключения PostgreSQL (переопределяет отдельные параметры ниже) |
| `DATABASE_HOST` | Хост PostgreSQL |
| `DATABASE_PORT` | Порт PostgreSQL |
| `DATABASE_NAME` | Имя базы данных PostgreSQL |
| `DATABASE_USER` | Пользователь PostgreSQL |
| `DATABASE_PASSWORD` | Пароль PostgreSQL |
| `DATABASE_SSL` | Включить SSL для PostgreSQL |
| `DATABASE_POOL_MAX` | Максимум подключений пула PostgreSQL |
| `DATABASE_POOL_IDLE` | Тайм-аут простоя пула PostgreSQL (мс) |
| `DATABASE_POOL_TIMEOUT` | Тайм-аут получения подключения пула PostgreSQL (мс) |
| `REMOTE_SSH_USER` | Пользователь SSH для удалённого развёртывания |
| `REMOTE_SSH_PASSWORD` | Пароль SSH для удалённого развёртывания |
| `XCODER_SSH_TARGETS` | SSH-цели флота (`host1:22,host2:22`) |
| `XCODER_SSH_USER` | Пользователь SSH флота |
| `XCODER_SSH_PASSWORD` | Пароль SSH флота |

Более полный шаблон `.env`:

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

### Поставщики LLM

Бэкенд LLM в xcoder полностью управляется конфигурацией: **DeepSeek — поставщик по умолчанию**, но любой совместимый с OpenAI поставщик (OpenAI, OpenRouter, Groq, Ollama, корпоративный прокси, …) и Anthropic можно выбрать, отредактировав `agent/config/llm.yaml` — **без изменения кода** и без CLI-флага для переключения поставщика (переключение поставщика выполняется только через файл конфигурации).

Ключи никогда не встраиваются в YAML: поле `api_key_env` указывает имя переменной окружения, в которой хранится ключ. Задайте именно эту переменную (в окружении или в файле `.env`), затем перезапустите любой запущенный процесс xcoder после изменения.

**Переключение на совместимый с OpenAI поставщик (пример OpenAI):**

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

**Переключение на Anthropic (игнорирует `base_url` и `endpoint`):**

```yaml
provider: anthropic
model: claude-sonnet-4-5
api_key_env: ANTHROPIC_API_KEY
```

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Правила маршрутизации:

1. Явный `base_url` всегда имеет приоритет над встроенным реестром.
2. Если `base_url` опущен, используется URL из реестра для известных поставщиков (`deepseek`, `openai`, `openrouter`, `groq`, `ollama`).
3. `endpoint` по умолчанию равен `/chat/completions`, если опущен.
4. `anthropic` игнорирует `base_url` и `endpoint`.

> `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` — устаревшие переменные, xcoder их **не читает**.

## Инициализация базы данных

SQLite — это вариант по умолчанию без настройки. Чтобы использовать хранилища на базе данных (история задач, отчёты о фазах, WBS, телеметрия), инициализируйте схему:

```bash
npm run init-db
```

Для PostgreSQL задайте `DATABASE_TYPE=postgres` и `DATABASE_URL` (или отдельные параметры `DATABASE_*`) перед запуском `npm run init-db`.

## Настройка среды разработки

Запуск из исходников без шага сборки:

```bash
npm run dev -- --task "Перечисли все файлы TypeScript в src/"
```

Запуск набора тестов:

```bash
npm test
```

Режим наблюдения для тестов:

```bash
npm run test:watch
```

Также доступны интерактивные помощники настройки:

```bash
npm run setup
npm run setup:non-interactive
```

## Дальнейшие шаги

- [readme.md](./readme.md) — обзор и быстрый старт
- [usage.md](./usage.md) — справочник CLI, выбор движка и тестирование
- [blurprint.md](./blurprint.md) — архитектура
