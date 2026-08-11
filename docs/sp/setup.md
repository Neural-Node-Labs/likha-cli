<!-- ronin:version 1 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T16:58:36.682Z | ronin:subtask code-st-d23750 -->
# xcoder — Instalación

Cómo instalar xcoder, configurar su entorno, inicializar la base de datos y establecer un flujo de trabajo de desarrollo.

## Requisitos previos

- **Node.js >= 18**
- **npm** (requerido para las dependencias de la interfaz)
- **Clave API de DeepSeek** — define `DEEPSEEK_API_KEY` en tu entorno o en un archivo `.env`

## Instalación

Instala las dependencias desde la raíz del proyecto (esto también instala las dependencias del frontend `ui/`):

```bash
npm run xcoder:install
```

Luego compila las fuentes TypeScript (el script `build` también copia el directorio de configuración `agent/` a `dist/config/`):

```bash
npm run build
```

Después de compilar, la CLI está disponible en `dist/cli/index.js` y se puede ejecutar con `npm start -- --task "..."`.

## Configuración del entorno

Crea un archivo `.env` en la raíz del proyecto. La configuración mínima es la clave API de DeepSeek:

```env
DEEPSEEK_API_KEY=sk-your-key-here
```

Se admiten las siguientes variables de entorno:

| Variable | Propósito |
|---|---|
| `DEEPSEEK_API_KEY` | Clave API de DeepSeek (requerida para ejecuciones LLM reales) |
| `DEEPSEEK_BASE_URL` | URL base de la API de DeepSeek |
| `DEEPSEEK_MODEL` | Nombre del modelo (predeterminado: `deepseek-chat`) |
| `ANTHROPIC_API_KEY` | Proveedor de respaldo opcional, usado si DeepSeek no está disponible/definido |
| `GITHUB_TOKEN` | Token para autenticación HTTPS de `github_tool` (clone/fetch/pull/push); se pasa solo como encabezado de autenticación en memoria |
| `XCODER_API_KEY` | Autenticación por token Bearer del servidor API; si no está definida, la API se ejecuta sin autenticación |
| `XCODER_API_PORT` | Puerto del servidor API (predeterminado: 3001) |
| `XCODER_API_HOST` | Host del servidor API (predeterminado: 0.0.0.0) |
| `MAX_ITERATIONS` | Límite de iteraciones del bucle ReAct por ronda |
| `XCODER_RESTRICT_TO_WORKSPACE` | Barrera de seguridad: rechaza rutas `read_tool`/`write_edit_tool` fuera del directorio de trabajo |
| `DATABASE_TYPE` | Backend de base de datos: `sqlite` (predeterminado) o `postgres` |
| `DATABASE_SQLITE_PATH` | Ruta del archivo de base de datos SQLite (predeterminado: `~/.xcoder/data/xcoder.db`) |
| `DATABASE_URL` | Cadena de conexión de PostgreSQL (anula los parámetros individuales siguientes) |
| `DATABASE_HOST` | Host de PostgreSQL |
| `DATABASE_PORT` | Puerto de PostgreSQL |
| `DATABASE_NAME` | Nombre de la base de datos PostgreSQL |
| `DATABASE_USER` | Usuario de PostgreSQL |
| `DATABASE_PASSWORD` | Contraseña de PostgreSQL |
| `DATABASE_SSL` | Habilitar SSL en PostgreSQL |
| `DATABASE_POOL_MAX` | Máximo de conexiones del pool de PostgreSQL |
| `DATABASE_POOL_IDLE` | Tiempo de inactividad del pool de PostgreSQL (ms) |
| `DATABASE_POOL_TIMEOUT` | Tiempo de adquisición del pool de PostgreSQL (ms) |
| `REMOTE_SSH_USER` | Usuario SSH para despliegue remoto |
| `REMOTE_SSH_PASSWORD` | Contraseña SSH para despliegue remoto |
| `XCODER_SSH_TARGETS` | Destinos SSH de la flota (`host1:22,host2:22`) |
| `XCODER_SSH_USER` | Usuario SSH de la flota |
| `XCODER_SSH_PASSWORD` | Contraseña SSH de la flota |

Una plantilla `.env` más completa:

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

## Inicialización de la base de datos

SQLite es la opción por defecto sin configuración. Para usar los almacenes respaldados por base de datos (historial de tareas, informes de fase, WBS, telemetría), inicializa el esquema:

```bash
npm run init-db
```

Para PostgreSQL, define `DATABASE_TYPE=postgres` y una `DATABASE_URL` (o los parámetros `DATABASE_*` individuales) antes de ejecutar `npm run init-db`.

## Configuración del desarrollo

Ejecuta desde la fuente sin paso de compilación:

```bash
npm run dev -- --task "Lista todos los archivos TypeScript en src/"
```

Ejecuta la suite de pruebas:

```bash
npm test
```

Modo de vigilancia para las pruebas:

```bash
npm run test:watch
```

También hay asistentes de configuración interactivos disponibles:

```bash
npm run setup
npm run setup:non-interactive
```

## Pasos siguientes

- [readme.md](./readme.md) — resumen e inicio rápido
- [usage.md](./usage.md) — referencia de la CLI, selección del motor y pruebas
- [blurprint.md](./blurprint.md) — arquitectura
