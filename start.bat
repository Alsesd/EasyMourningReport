@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not defined HOST set HOST=127.0.0.1
if not defined PORT set PORT=8000

:: ==========================================
:: 1. TAILSCALE CHECKS & SETUP
:: ==========================================
where tailscale >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Tailscale CLI not found in PATH. Running in local-only mode.
    goto :START_APP
)

:: Check if GUI (tailscale-ipn.exe) is running; start if missing
tasklist /fi "imagename eq tailscale-ipn.exe" 2>nul | find /i "tailscale-ipn.exe" >nul
if %errorlevel% neq 0 (
    echo [*] Starting Tailscale GUI...
    if exist "%ProgramFiles%\Tailscale\tailscale-ipn.exe" (
        start "" "%ProgramFiles%\Tailscale\tailscale-ipn.exe"
    ) else if exist "%LocalAppData%\Tailscale\tailscale-ipn.exe" (
        start "" "%LocalAppData%\Tailscale\tailscale-ipn.exe"
    ) else (
        start tailscale-ipn 2>nul
    )
    timeout /t 2 /nobreak >nul
)

:: Check login/daemon status
tailscale status >nul 2>nul
if %errorlevel% neq 0 (
    echo [*] Tailscale is not logged in or daemon is stopped. Opening login...
    tailscale login
    tailscale status >nul 2>nul
    if %errorlevel% neq 0 (
        echo [!] Login not completed. Skipping Funnel.
        goto :START_APP
    )
)

:: Enable Funnel
echo [*] Starting Tailscale Funnel on port %PORT%...
tailscale funnel --bg %PORT%
set COOKIE_SECURE=1
echo.
tailscale funnel status

:: ==========================================
:: 2. APPLICATION LAUNCH
:: ==========================================
:START_APP
echo.
echo Local address: http://localhost:%PORT%
echo.

:: 1. Compiled standalone binary check (PyOxidizer)
if exist "dist\LegkyiZvit.exe" (
    echo [*] Binary detected: dist\LegkyiZvit.exe
    echo Close this window or press Ctrl+C to stop the server.
    dist\LegkyiZvit.exe
    goto :EXIT
)
if exist "LegkyiZvit.exe" (
    echo [*] Binary detected: LegkyiZvit.exe
    echo Close this window or press Ctrl+C to stop the server.
    LegkyiZvit.exe
    goto :EXIT
)

:: 2. Python environment validation
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Python is not found in PATH.
    pause
    exit /b 1
)

:: 3. Setup venv if missing
if not exist ".venv" (
    echo [*] .venv folder missing. Installing dependencies via Poetry...
    python -m poetry install
    if %errorlevel% neq 0 (
        echo [!] Poetry install failed.
        pause
        exit /b %errorlevel%
    )
)

:: 4. Run through run.py entrypoint
if exist "run.py" (
    echo [*] Launching entrypoint via run.py...
    echo Close this window or press Ctrl+C to stop the server.
    python -m poetry run python run.py
) else (
    echo [!] run.py not found. Falling back to module execution...
    echo Close this window or press Ctrl+C to stop the server.
    python -m poetry run uvicorn app.main:app --host %HOST% --port %PORT%
)

:EXIT
pause
