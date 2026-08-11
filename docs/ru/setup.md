<!-- ronin:version 1 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T16:59:34.127Z | ronin:subtask code-st-d23750 -->
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
| `DEEPSEEK_API_KEY` | Ключ API DeepSeek (требуется для реальных запусков LLM) |
| `DEEPSEEK_BASE_URL` | Базовый URL API DeepSeek |
| `DEEPSEEK_MODEL` | Имя модели (по умолчанию: `deepseek-chat`) |
| `ANTHROPIC_API_KEY` | Необязательный запасной поставщик, используется, если DeepSeek недоступен/не задан |
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
