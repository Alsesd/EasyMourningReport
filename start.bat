@echo off
cd /d "%~dp0"
if not defined HOST set HOST=127.0.0.1
if not defined PORT set PORT=8000

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
echo Local address: http://localhost:%PORT%

if exist LegkyiZvit.exe (
  echo Close this window or press Ctrl+C to stop the server.
  LegkyiZvit.exe
) else (
  where poetry >nul 2>nul
  if %errorlevel%==0 (set POETRY=poetry) else (set POETRY=python -m poetry)
  %POETRY% install
  %POETRY% run uvicorn app.main:app --host %HOST% --port %PORT%
)
pause
