@echo off
setlocal
cd /d "%~dp0"

if not defined HOST set HOST=127.0.0.1
if not defined PORT set PORT=8000

echo EasyMourningReport starts locally by default.
echo Public Tailscale Funnel is controlled only from the authenticated admin UI.
echo.

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

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Python is not found in PATH.
    pause
    exit /b 1
)

if not exist ".venv" (
    echo [*] .venv folder missing. Installing dependencies via Poetry...
    python -m poetry install
    if %errorlevel% neq 0 (
        echo [!] Poetry install failed.
        pause
        exit /b %errorlevel%
    )
)

if exist "run.py" (
    echo [*] Launching entrypoint via run.py...
    echo Local address: http://localhost:%PORT%
    python -m poetry run python run.py
) else (
    echo [!] run.py not found. Falling back to module execution...
    python -m poetry run uvicorn app.main:app --host %HOST% --port %PORT%
)

:EXIT
pause
