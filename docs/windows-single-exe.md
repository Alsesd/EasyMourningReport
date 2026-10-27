# Windows standalone executable

The `Windows single-exe build` workflow builds `LegkyiZvit.exe` on a Windows runner. It runs the backend test suite, frontend type checks and tests, builds the React SPA, bundles Python and the application dependencies with PyInstaller, embeds the Windows `cloudflared.exe` helper, and smoke-tests the frozen application before uploading the artifact.

## Persistent storage

The executable is replaceable; the data directory is not part of the executable. By default, a writable install folder stores data next to the EXE. If the folder is not writable (for example, an install under Program Files), the application falls back to:

`%LOCALAPPDATA%\LegkyiZvit`

To explicitly select a portable or shared data folder, set `LEGKYI_DATA_DIR`. Backups can be placed elsewhere with `LEGKYI_BACKUPS_DIR`.

For a portable folder layout compatible with the Docker bind-mount convention, place the executable at the project folder root and launch it with:

```powershell
$env:LEGKYI_DATA_DIR = Join-Path $PWD "app_storage\data"
$env:LEGKYI_BACKUPS_DIR = Join-Path $PWD "app_storage\backups"
.\LegkyiZvit.exe
```

This creates `app_storage\data\reports.db`, `app_storage\data\secret.key`, and the backup directory `app_storage\backups`. For a Docker migration, stop both app and backup containers before copying the SQLite database and secret key; copy the existing backups folder too. Do not run the same SQLite database from the EXE and Docker at the same time.

## Updating safely

1. Stop the running EXE.
2. Make a copy of `app_storage\data` and `app_storage\backups` (or the selected storage folders).
3. Replace only `LegkyiZvit.exe`.
4. Start the new executable with the same storage environment variables.

Never delete `reports.db` or `secret.key` during an application update. Keeping the secret key preserves existing session-signing continuity, while the SQLite database preserves users, products, stores, reports, and history.

## Downloading the build

On the GitHub branch, open **Actions → Windows single-exe build**, select a successful run, and download the `LegkyiZvit-Windows-x64` artifact. The artifact is temporary (14-day retention) and is not a signed installer. Windows SmartScreen may still display a reputation warning for an unsigned executable.

The workflow smoke test confirms the executable starts, serves the compiled SPA and its local assets, answers an API probe, and reuses the same SQLite database and session secret after a restart. Passing this smoke test is not a substitute for manual acceptance of every UI workflow; the backend and frontend test suites are run separately in the same workflow.
