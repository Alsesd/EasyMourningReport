# EasyMourningReport / Легкий звіт

A modular FastAPI + React platform: organisations with multiple user accounts, roles and permissions, and feature modules (monthly store reports today, transport orders next), plus audit logs and controlled public access through a tunnel. See [docs/architecture.md](docs/architecture.md) for the module contract and how to add a feature. SQLite remains the default local database; the project includes an explicit SQLite-to-PostgreSQL data-transfer tool for later database moves.

## Repository layout

```text
repo/
├── backend/
│   └── app/
│       ├── main.py              # FastAPI composition only
│       ├── __main__.py          # single runtime entry point: python -m app
│       ├── core/                # module contract, security, paths, validation, HTTP handlers
│       ├── db/                  # engine/sessions, backups, migration runner, bootstrap
│       ├── platform/            # accounts (organisations, users, roles, permissions), audit, system
│       ├── modules/             # one self-contained folder per feature: reports/, transport/
│       ├── routes/              # PWA, legacy form sign-in, SPA fallback, router composition
│       ├── static/              # PWA assets and compiled React app
│       ├── templates/           # minimal error and offline fallback templates
│       └── tests/               # platform pytest suite (module tests live in each module)
├── frontend/
│   └── src/
│       ├── app/                 # shell: router, layout, login page, module registry
│       ├── platform/            # API client/types, auth, i18n, theme, access & settings pages
│       ├── ui/                  # reusable design-system primitives
│       └── modules/
│           ├── reports/         # report pages, settings sections, API, strings, tests
│           └── transport/       # transport orders (scaffold)
├── deploy/                      # production Dockerfile, Compose and env example (one container)
├── docs/                        # API, architecture, ADRs, module notes and design docs
└── scripts/                     # module scaffold, DB migration and OpenAPI export
```

## Local development

Requirements: Python 3.11 (3.10+ is supported by the code), uv, Node.js 22.22.2+ and npm (the current lockfile includes packages that require recent Node 22 releases).

Install `uv` first (see the [official installation guide](https://docs.astral.sh/uv/getting-started/installation/)), then sync the environment and launch the backend from its package root:

```bash
uv sync
cd backend
uv run --project .. python -m app
```

`uv.lock` is committed. When dependencies in `pyproject.toml` change, run `uv lock` and review the lockfile diff; Docker builds install exactly what the lockfile pins.

The server binds to `127.0.0.1:8000` by default. `HOST` and `PORT` override that address. The single runtime entry point is `python -m app`; `backend/app/main.py` only composes FastAPI and is also the ASGI import target `app.main:app`.

Run backend tests from the repository root:

```bash
uv run --locked pytest
```

Run the frontend separately during development:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite serves the app there (deep links work) and forwards `/api`, `/healthz`, `/manifest.webmanifest` and the backend's static icons to `http://127.0.0.1:8000`; set `BACKEND_URL` to use another backend port. The `Host` header is kept, so the backend's same-origin check accepts sign-in and saves. To check the frontend:

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

The production frontend build is written to `backend/app/static/app/`. The Docker build does not require a previously built frontend because its Node build stage creates these assets.

## Upgrading from the single-admin release

The first start of this version migrates the database automatically and writes a `before-migrate` backup into `backups/` first. Each store becomes an **organisation** and keeps its login, which gets the «Магазин» role. The administrator keeps their login and gets the «Адміністратор» role. Reports, prices and the «По розрахунку» settings are preserved. Afterwards, add more users per organisation and define roles under **Адміністрування → Доступ**.

## Docker deployment

Copy the env template, review its values, and start Compose from the repository root:

```bash
cp deploy/.env.example .env
docker compose up -d --build
```

The root `compose.yaml` is a small wrapper that includes `deploy/compose.yaml`, so the usual `docker compose up -d` works from the repository root. Use Docker Compose v2.24 or newer (it uses `include` and optional `env_file`).

Everything runs in **one container**, `mourningreport-app`: the web server, the SQLite database, periodic backups and the Cloudflare Tunnel (`cloudflared` is started and supervised by the app). The container publishes the configured host port (default `8000`) and keeps its data in bind-mounted host folders:

| Host folder | In the container | Contents |
|---|---|---|
| `./app_storage/data` | `/app/data` | `reports.db`, `secret.key`, tunnel token |
| `./app_storage/backups` | `/app/backups` | verified SQLite backups |

**Do not delete or rename those folders during an update.** To update, back up both folders, pull the new source, then run:

```bash
docker compose up -d --build --remove-orphans
```

`--remove-orphans` removes the `mourningreport-backup` container that older releases ran next to the app; backups now run inside the app (every `BACKUP_EVERY_MIN` minutes when something changed, plus at start-up and shutdown, keeping `BACKUP_KEEP` copies). Follow the logs with `docker compose logs -f app`; `GET /healthz` is the container health probe.

Useful environment values are documented in `deploy/.env.example`. Keep `.env`, `secret.key`, the database and backups out of version control.

### Public access (Cloudflare Tunnel)

Open **Адміністрування → Система → Публічний доступ**. Without a token the app opens a temporary Quick Tunnel and shows its `trycloudflare.com` address. With a Cloudflare tunnel token (pasted there, or `TUNNEL_TOKEN` in `.env`) it runs your named tunnel; set `PUBLIC_URL` to show its address. `TUNNEL_ENABLED=0` keeps the tunnel off at start-up regardless of the saved preference.

### Power cuts and the database

SQLite runs inside the app and needs no server. Each committed change is flushed to disk (`synchronous=FULL`), so a power cut loses no saved report. On local disks the database uses WAL mode; on shared folders (Docker Desktop host folders, network shares) it falls back to the classic rollback journal, which is safe there. Override with `SQLITE_JOURNAL_MODE=wal|delete`. Every start runs an integrity check, and every backup is verified. The reasoning, with load-test numbers, is in [ADR 0003](docs/adr/0003-keep-sqlite.md).

## Project scripts

Scaffold a new feature module (backend and frontend halves, with tests) without overwriting anything:

```bash
python3 scripts/new_module.py inventory --title "Склад"
```

Run the browser end-to-end check (needs Playwright; `CHROMIUM_PATH` reuses an installed Chromium):

```bash
uv run --with playwright python scripts/e2e_test.py
```

Export the current OpenAPI schema for TypeScript generation:

```bash
python scripts/dump_openapi.py > openapi.json
```

See [Architecture](docs/architecture.md), [REST API](docs/API.md), and the module notes in `docs/modules/` before making structural changes.
