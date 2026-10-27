# EasyMourningReport / Легкий звіт

A FastAPI + React application for monthly store reports, product-price histories, audit logs, and controlled public access through a tunnel. SQLite remains the default local database; the project includes an explicit SQLite-to-PostgreSQL data-transfer tool for later database moves.

## Repository layout

```text
repo/
├── backend/
│   └── app/
│       ├── main.py              # FastAPI composition only
│       ├── __main__.py          # single runtime entry point: python -m app
│       ├── core/                # lifecycle, security, paths, validation, HTTP handlers
│       ├── db/                  # SQLModel models, sessions, repositories, backups
│       ├── routes/              # REST, authentication, PWA and SPA fallback routes
│       ├── services/            # business operations (pricing, Excel)
│       ├── static/              # PWA assets and compiled React app
│       ├── templates/           # minimal error and offline fallback templates
│       └── tests/               # pytest suite
├── frontend/
│   └── src/
│       ├── app/                 # app shell, providers, layouts and login page
│       ├── platform/            # API client/types, auth guard, offline draft queue
│       ├── ui/                  # reusable design-system primitives
│       └── modules/
│           ├── reports/         # report pages, API, localization and tests
│           └── transport/       # public tunnel API surface
├── deploy/                      # production Dockerfile, Compose, env example and backup sidecar configuration
├── docs/                        # API, architecture, ADRs, module notes and design docs
└── scripts/                     # module scaffold, DB migration and OpenAPI export
```

## Local development

Requirements: Python 3.11 (3.10+ is supported by the code), uv, Node.js 22.22.2+ and npm (the current lockfile includes packages that require recent Node 22 releases).

Install `uv` first (see the [official installation guide](https://docs.astral.sh/uv/getting-started/installation/)). On the first checkout after migrating from PDM, generate the new lockfile once, then sync the environment and launch the backend from its package root:

```bash
uv lock
uv sync
cd backend
uv run --project .. python -m app
```

Commit `uv.lock` to version control. When dependencies in `pyproject.toml` change, run `uv lock` again and review the lockfile diff. Other machines and Docker builds should use that checked-in lockfile rather than resolving a different set of versions.

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

Vite proxies `/api` and `/static` to `http://127.0.0.1:8000`. To check the frontend:

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

The production frontend build is written to `backend/app/static/app/`. The Docker build does not require a previously built frontend because its Node build stage creates these assets.

## Docker deployment

Copy the env template, review its values, and start Compose from the repository root. For reproducible releases, generate and commit `uv.lock` from an internet-connected checkout before building the image. The Dockerfile has a temporary first-build fallback if the lockfile is absent, but release builds should use the checked-in lockfile.

```bash
# One-time migration step, only if uv.lock is absent
uv lock
cp deploy/.env.example .env
docker compose up -d --build
```

The root `compose.yaml` intentionally remains as a small compatibility wrapper that includes `deploy/compose.yaml`; this preserves the existing `docker compose up -d` workflow while keeping the canonical deployment files together. Use Docker Compose v2.24 or newer; this setup uses `include` and optional `env_file` handling.

The web container remains named `mourningreport-app`, publishes the configured host port (default `8000`), and binds persistent host folders into `/app/data` and `/app/backups`. A separate `mourningreport-backup` sidecar uses the same SQLite online-backup routine and retention settings; the app keeps on-demand/startup/shutdown snapshots but disables its own periodic loop while the sidecar is enabled. Default host paths remain `./data` and `./backups` at the repository root. **Do not delete or rename those folders during an update.** To update an existing deployment, back up `data/` and `backups/`, pull/replace the source or image as applicable, then run:

```bash
docker compose up -d --build
```

Follow the web app or periodic backups with:

```bash
docker compose logs -f app
docker compose logs -f backup
```

Useful environment values are documented in `deploy/.env.example`. Keep `.env`, `secret.key`, the SQLite database, and backups out of version control.

## Database transfer helper

`scripts/sqlite_to_postgres.py` can migrate a whole SQLite database or copy selected tables into an already-created PostgreSQL schema. It preserves row data and explicit primary-key values, batches inserts, and advances PostgreSQL serial/identity sequences where available. It does not delete destination rows unless `--replace` is explicitly set.

Install a PostgreSQL driver in the migration environment, for example `pip install 'psycopg[binary]'`, then use a SQLAlchemy URL:

```bash
export DATABASE_URL='postgresql+psycopg://user:password@host:5432/database'
python scripts/sqlite_to_postgres.py --source ./data/reports.db --target "$DATABASE_URL"
```

For a partial transfer, ensure the destination table and its foreign-key dependencies already exist, then name only the table(s):

```bash
python scripts/sqlite_to_postgres.py \
  --source ./data/reports.db \
  --target "$DATABASE_URL" \
  --tables reports
```

The helper copies data; it does not switch the running application from SQLite to PostgreSQL. Application database-backend support should be changed and tested separately before changing production configuration.

## Project scripts

Scaffold a new frontend module without overwriting an existing one:

```bash
python scripts/new_module.py inventory --title "Inventory"
```

Export the current OpenAPI schema for TypeScript generation:

```bash
python scripts/dump_openapi.py > openapi.json
```

See [Architecture](docs/architecture.md), [REST API](docs/API.md), and the module notes in `docs/modules/` before making structural changes.
