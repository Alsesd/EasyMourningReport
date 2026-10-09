@echo off
cd /d "%~dp0"
where poetry >nul 2>nul
if %errorlevel%==0 (set POETRY=poetry) else (set POETRY=python -m poetry)
%POETRY% install
if not defined HOST set HOST=127.0.0.1

where tailscale >nul 2>nul
if %errorlevel%==0 (
  tailscale funnel --bg 8000
  set COOKIE_SECURE=1
  echo.
  tailscale funnel status
) else (
  echo.
  echo Tailscale not found: the site is reachable only on this PC. See README, section HTTPS.
)
echo.
echo Local address: http://localhost:8000
echo Close this window or press Ctrl+C to stop the server.
%POETRY% run uvicorn app.main:app --host %HOST% --port 8000
pause
