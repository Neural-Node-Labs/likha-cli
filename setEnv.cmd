DOS
@echo off
setlocal enabledelayedexpansion

:: Check if .env file exists
if not exist .env (
    echo Error: .env file not found!
    pause
    exit /b
)

:: Read the .env file line by line
for /f "usebackq tokens=1* delims==" %%A in (".env") do (
    set "line=%%A"

    :: Skip empty lines and comments (starting with #)
    if defined line if not "!line:~0,1!"=="#" (
        set "%%A=%%B"
        echo Loaded: %%A = %%B
    )
)

echo.
echo All variables from .env loaded successfully!
pause

