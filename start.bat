@echo off
setlocal
cd /d "%~dp0"

if not defined HOST set "HOST=127.0.0.1"
if not defined PORT set "PORT=8000"

echo ==========================================
echo  Legkyi Zvit
echo ==========================================
echo.
echo The app-specific Tailscale Funnel is managed from Settings in the web UI.
echo No system Tailscale CLI or separate daemon is required for the bundled helper.
echo.

if exist "dist\LegkyiZvit.exe" (
    echo [*] Starting standalone Windows executable...
    "dist\LegkyiZvit.exe"
    goto :EXIT
)
if exist "LegkyiZvit.exe" (
    echo [*] Starting standalone Windows executable...
    "LegkyiZvit.exe"
    goto :EXIT
)

where python >nul 2>nul
if errorlevel 1 (
    echo [!] Python is not found in PATH.
    pause
    exit /b 1
)

if not exist ".venv" (
    echo [*] Virtual environment missing. Installing dependencies with Poetry...
    python -m poetry install
    if errorlevel 1 (
        echo [!] Poetry install failed.
        pause
        exit /b 1
    )
)

if not exist "run.py" (
    echo [!] run.py not found.
    pause
    exit /b 1
)

echo Local address: http://%HOST%:%PORT%
echo Tailscale Funnel can be enabled in Settings after the app starts.
echo.
python -m poetry run python run.py

:EXIT
pause
