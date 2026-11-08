# Repository map (as audited 2026-11-06)

Audit of branch `claude/repo-setup-config-2m4o0o` at `f10b236`. Statements here were checked against source and, where marked **(probed)**, against a running instance on a throwaway data directory.

## Size and shape

| Area | Path | Notes |
|---|---|---|
| Backend app code | `backend/app/**/*.py` (excluding tests) | About 3.5k lines. FastAPI, SQLModel 0.0.24, SQLAlchemy 2, openpyxl, itsdangerous (via Starlette sessions), uvicorn |
| Backend tests | `backend/app/tests/`, `backend/app/modules/*/tests/` | 170 pytest tests, all passing |
| Frontend | `frontend/src/` | React 18, Vite 6, TanStack Query 5, Tailwind 3. 55 vitest tests, all passing |
| Generated API types | `frontend/src/platform/api/schema.d.ts` | Generated from FastAPI OpenAPI by `npm run gen:api`. **The Go backend must keep this pipeline or replace it** (see migration-risks.md, R9) |
| Deploy | `deploy/Dockerfile`, `deploy/compose.yaml`, `compose.yaml` (include wrapper), `deploy/.env.example` | One container |
| Dev env | `flake.nix`, `.claude/` | Nix shell (python311, uv, node22, cloudflared); Claude session hook runs `uv sync`, `npm ci` and builds the SPA |
| Scripts | `scripts/new_module.py` (scaffold), `scripts/e2e_test.py` (Playwright, port 8888, `DEMO=1`), `scripts/dump_openapi.py` | |

### Generated, ignored and irrelevant files

- `backend/app/static/app/` is the Vite build output. It is gitignored and none of it is tracked; it exists locally only because the session hook builds it.
- `frontend/node_modules`, `.venv` are local installs.
- `flake.nix`/`flake.lock` are only for Nix users. They are not used by Docker or Windows.
- The service worker `backend/app/static/sw.js` and the files in `backend/app/static/*.png|webmanifest|offline.html` are hand-maintained, not generated.

## Runtime flow (Python today)

1. `python -m app`, run from `backend/` (`backend/app/__main__.py`):
   - Loads the repository-root `.env` without overriding variables already exported.
   - Prints a banner and probes that the data and backup folders are writable.
   - Starts `uvicorn.run(app, proxy_headers=True, forwarded_allow_ips=FORWARDED_ALLOW_IPS or "127.0.0.1")` on `HOST` (default `127.0.0.1`) and `PORT` (default `8000`).
2. `backend/app/main.py` composes the app in this order: same-origin guard middleware, `SessionMiddleware` (7-day cookie), `/static` mount, the API router (PWA routes plus every module router under `/api/v1`), the SPA fallback (last), then exception handlers.
3. `backend/app/lifecycle.py` lifespan:
   - Runs `PRAGMA quick_check`. A failure is only logged; the app still starts.
   - Runs `migrate()`, then `seed()`, which ensures the built-in roles exist and, on an empty user table, creates the first admin.
   - Takes a backup, starts the backup loop, then starts the tunnel if it is enabled.
   - On shutdown: stops the tunnel, cancels the loop, runs a WAL checkpoint, and takes a final backup.
4. Persistent paths (`backend/app/core/paths.py`, `backend/app/db/session.py`, `backend/app/db/backup.py`):
   - The data dir is `LEGKYI_DATA_DIR`. If unset, the folder next to the exe (frozen build) or the repository root (source run). If that folder is not writable: `%LOCALAPPDATA%\LegkyiZvit` on Windows, `$XDG_DATA_HOME` or `~/.local/share/LegkyiZvit` elsewhere.
   - The data dir holds `reports.db`, `secret.key`, `tunnel/token`, `tunnel/cloudflared.log` and `.tunnel-enabled`.
   - Backups go to `LEGKYI_BACKUPS_DIR`, or `<data>/backups` when that is unset.

## Build flow

- Frontend: `npm ci && npm run build` (runs `tsc` then `vite build`). Output goes to `backend/app/static/app/` with base `/static/app/`.
- Docker (`deploy/Dockerfile`):
  1. `node:22-alpine` builds the SPA.
  2. `python:3.11-slim` runs `uv sync --locked --no-dev`.
  3. The runtime stage is `python:3.11-slim` plus curl, ca-certificates and `cloudflared:latest`. It copies `backend/app` and the SPA, and runs `CMD python -m app`. Environment: `LEGKYI_DATA_DIR=/app/data`, `LEGKYI_BACKUPS_DIR=/app/backups`, `HOST=0.0.0.0`.
  4. Health check: `curl /healthz`.
- Compose: container `mourningreport-app`, `init: true`, bind mounts `./app_storage/data:/app/data` and `./app_storage/backups:/app/backups`, and environment pass-through for BACKUP_*, ADMIN_PASSWORD, SECRET_KEY, DEMO, PUBLIC_URL and TUNNEL_*.
- **Windows: no build pipeline exists in the repo.**
  - `paths.py` handles a PyInstaller-style frozen exe (`sys.frozen`), and `*.spec` is gitignored. How the current Windows build is produced is unknown (see the question in migration-plan.md).
  - Journal-mode detection reads `/proc/mounts`, so on Windows it always picks WAL.

## Environment variables actually read by the code

| Variable | Read in | Default |
|---|---|---|
| `HOST`, `PORT` | `__main__.py` (PORT also by `tunnel.py` for the quick-tunnel target) | `127.0.0.1`, `8000` |
| `FORWARDED_ALLOW_IPS` | `__main__.py` | `127.0.0.1` |
| `LEGKYI_DATA_DIR`, `LEGKYI_BACKUPS_DIR` | `core/paths.py`, `db/backup.py` | see above |
| `SECRET_KEY` | `core/security.py` | `data/secret.key`, generated as 64 hex characters |
| `COOKIE_SECURE` | `main.py` | off |
| `SQLITE_JOURNAL_MODE` | `db/session.py` | `auto` |
| `BACKUP_KEEP`, `BACKUP_EVERY_MIN` | `db/backup.py` | `100`, `60` |
| `ADMIN_PASSWORD`, `DEMO` | `platform/bootstrap.py` | random password printed once; demo off |
| `TUNNEL_ENABLED`, `TUNNEL_TOKEN`, `PUBLIC_URL`, `CLOUDFLARED_PATH` | `platform/system/tunnel.py` | |
| `XDG_DATA_HOME`, `LOCALAPPDATA` | `core/paths.py` | |

## Documentation that is inaccurate today (verified)

- README "Repository layout" lists `backend/app/templates/` and "legacy form sign-in". Neither exists.
- README intro mentions an SQLite-to-PostgreSQL transfer tool. ADR 0003 says it was removed.
- README says `scripts/` holds DB migration tools. It does not.
- `docs/API.md` → "Client rendering" mentions Jinja templates. There are none: error pages are inline HTML in `core/http_errors.py`.
- ADR 0002 mentions a "no-lock fallback" in the Dockerfile. There is none: the Dockerfile runs `uv sync --locked` only.

## Tooling in this environment

Available: Go 1.24.7, Node 22.23.4, npm 10.9.9, Python 3.13.18 (Docker uses 3.11), uv 0.11.32, git 2.43, ripgrep 14.1, jq 1.7, Chromium + Playwright.

Missing: `tree`, `ast-grep`, `repomix`, `gopls`, `staticcheck`, the `sqlite3` CLI.

- None of these were needed for the audit. `rg`, `find` and Python's `sqlite3` module covered everything.
- `gopls` and `staticcheck` become useful once Go code exists.
- The environment setup script, which installs these tools, was fixed during the audit: it was calling `git rev-parse` outside the repo.
