@echo off
REM ──────────────────────────────────────────────────────────────────────────────
REM devnull-server.bat — Standalone devnull API server launcher (Windows, no Docker)
REM
REM Starts the devnull HTTP API server with SQLite database backend.
REM The SQLite database is auto-created on first run — no separate DB process needed.
REM
REM Usage:
REM   scripts\devnull-server.bat                    Start on default port 3001
REM   set DEVNULL_API_PORT=8080 && scripts\devnull-server.bat  Custom port
REM
REM Environment:
REM   DEVNULL_API_PORT    API server port (default: 3001)
REM   DEVNULL_API_HOST    API server bind address (default: 0.0.0.0)
REM   DEVNULL_HOME        Runtime home directory (default: script parent dir)
REM   DEEPSEEK_API_KEY    Required for LLM features (set in .env)
REM   NODE_ENV            Runtime environment (default: production)
REM ──────────────────────────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

REM ─── Paths ───────────────────────────────────────────────────────────────────
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_DIR=%%~fI"

REM ─── Configuration ───────────────────────────────────────────────────────────
if not defined DEVNULL_HOME set "DEVNULL_HOME=%PROJECT_DIR%"
if not defined DEVNULL_API_PORT set "DEVNULL_API_PORT=3001"
if not defined DEVNULL_API_HOST set "DEVNULL_API_HOST=0.0.0.0"
if not defined NODE_ENV set "NODE_ENV=production"

echo.
echo ═══════════════════════════════════════════════════════════════════════
echo   devnull Server Launcher
echo ═══════════════════════════════════════════════════════════════════════
echo.

REM ─── Pre-flight checks ───────────────────────────────────────────────────────

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not on PATH.
    echo [ERROR] Install Node.js 20+ from https://nodejs.org/
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node --version') do set "NODE_MAJOR=%%a"
if !NODE_MAJOR! LSS 18 (
    echo [ERROR] Node.js 18+ required (found: !NODE_MAJOR!)
    exit /b 1
)
echo [OK]    Node.js
node --version

REM Check for compiled JS
if not exist "%DEVNULL_HOME%\dist\cli\index.js" (
    echo [ERROR] Compiled JS not found at %DEVNULL_HOME%\dist\cli\index.js
    echo [ERROR] Run 'npm run build' first, or set DEVNULL_HOME to the package root.
    exit /b 1
)
echo [OK]    Build artifacts found at %DEVNULL_HOME%\dist\

REM Check for node_modules
if not exist "%DEVNULL_HOME%\node_modules" (
    echo [ERROR] node_modules/ not found at %DEVNULL_HOME%\node_modules
    echo [ERROR] Run 'npm install --omit=dev' first.
    exit /b 1
)
echo [OK]    Production dependencies installed

REM Check .env
if exist "%DEVNULL_HOME%\.env" (
    echo [OK]    .env file found
) else (
    echo [WARN]  .env file not found at %DEVNULL_HOME%\.env
    echo [WARN]  Copy .env.example to .env and configure your API keys.
)

REM Create required runtime directories
if not exist "%DEVNULL_HOME%\.log" mkdir "%DEVNULL_HOME%\.log"
if not exist "%DEVNULL_HOME%\.agent\index" mkdir "%DEVNULL_HOME%\.agent\index"
echo [OK]    Runtime directories created/verified

REM ─── Start server ────────────────────────────────────────────────────────────
echo.
echo ═══════════════════════════════════════════════════════════════════════
echo   Starting devnull API Server
echo   Port: %DEVNULL_API_PORT%
echo   Host: %DEVNULL_API_HOST%
echo   Home: %DEVNULL_HOME%
echo ═══════════════════════════════════════════════════════════════════════
echo.

REM Change to the project directory
cd /d "%DEVNULL_HOME%"

REM Start the server
echo [INFO]  Starting server...
echo.

start "devnull-server" cmd /c "node dist\cli\index.js --serve --port %DEVNULL_API_PORT% --host %DEVNULL_API_HOST%"

REM Wait a moment for the server to start
timeout /t 3 /nobreak >nul

REM Check if the server is running
tasklist /fi "WindowTitle eq devnull-server" 2>nul | findstr /i "node.exe" >nul
if %ERRORLEVEL% equ 0 (
    echo [OK]    Server started successfully
    echo.
    echo   API:      http://%DEVNULL_API_HOST%:%DEVNULL_API_PORT%
    echo   Health:   http://%DEVNULL_API_HOST%:%DEVNULL_API_PORT%/api/v1/health
    echo   Logs:     %DEVNULL_HOME%\.log\
    echo   SQLite:   %%USERPROFILE%%\.devnull\data\devnull.db
    echo.
    echo   Close the server window to stop, or run:
    echo     taskkill /fi "WindowTitle eq devnull-server"
    echo.
) else (
    echo [ERROR] Server failed to start
    exit /b 1
)

endlocal
