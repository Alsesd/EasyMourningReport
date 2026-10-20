# EasyMourningReport: two deployment targets

The normal application and its Windows/Poetry workflow remain the primary
source of truth. Cloudflare has its own isolated `uv` project and a build
step that stages the current `app/` and `src/` code. The root
`pyproject.toml` and `poetry.lock` are not repurposed for Pywrangler.

| Mode | Entry point | Database | Static files |
|---|---|---|---|
| Local / VPS / Windows | `python run.py` or `uvicorn app.main:app` | SQLite by default; PostgreSQL when `DATABASE_URL` is set | FastAPI serves `app/static/` |
| Cloudflare Workers | `cloudflare/_build/src/worker.py` via Pywrangler | PostgreSQL via `DATABASE_URL` secret | Cloudflare ASSETS binding backed by `app/static/` |

For VPS and Worker to share live data, configure both with the **same
PostgreSQL database**. The existing SQLite file is not copied into PostgreSQL
automatically. Keep SQLite as the default for standalone Windows installs
unless you intentionally set `DATABASE_URL`.

## Cloudflare setup

### 1. Prerequisites

- A Cloudflare account and a domain managed by Cloudflare.
- Node.js, uv, and Python 3.13+ on the deployment machine.
- A PostgreSQL database reachable from Cloudflare Workers.

Cloudflare Python Workers run in Pyodide. The adapter uses SQLAlchemy with the
pure-Python `pg8000` driver; Workers' TCP support is runtime-specific. For
production database connections, Cloudflare Hyperdrive is recommended for
connection pooling. Validate the actual database connection in local Worker
development before using a production database.

### 2. Configure Worker secrets

Run these commands from the repository root:

```sh
cd cloudflare
uv sync --group dev
uv run --group dev pywrangler secret put DATABASE_URL
uv run --group dev pywrangler secret put SECRET_KEY
uv run --group dev pywrangler secret put ADMIN_PASSWORD
```

For `DATABASE_URL`, use a SQLAlchemy URL, for example:

```text
postgresql+pg8000://app_user:URL_ENCODED_PASSWORD@db-host:5432/app_db
```

URL-encode special characters in credentials. Use a long random `SECRET_KEY`
and keep it stable across deployments. Set `ADMIN_PASSWORD` before the first
start so the initial admin password is never generated or printed in Worker
logs. Secrets are not stored in `wrangler.jsonc`.

For local development, copy `cloudflare/.dev.vars.example` to
`cloudflare/.dev.vars` and fill in test-only credentials. Keep that file
private; it is ignored by Git.

For Hyperdrive, create a configuration for the PostgreSQL database, then add
this binding to `cloudflare/wrangler.jsonc` (use the ID returned by Wrangler):

```json
"hyperdrive": [
  { "binding": "HYPERDRIVE", "id": "YOUR_HYPERDRIVE_CONFIG_ID" }
]
```

When the `HYPERDRIVE` binding is present, the Worker builds its SQLAlchemy URL
from that binding and does not require the `DATABASE_URL` secret. Keep
`SECRET_KEY` and `ADMIN_PASSWORD` configured either way.

### 3. Build and run locally

From the repository root:

```sh
python cloudflare/build.py
cd cloudflare
uv run --group dev pywrangler dev
```

The build script copies the current app sources into the ignored
`cloudflare/_build/` directory and bundles all Jinja templates. Do not edit
files in `_build/`; edit the root `app/` or `src/` files and rebuild.

Before production, smoke-test login, product creation, price changes, monthly
reports, Excel import/export, sessions, and static CSS/JS against a staging
database. The first non-static application request initializes the SQLModel
schema and initial admin user.

### 4. Deploy

```sh
cd cloudflare
sh deploy.sh
```

The Wrangler config uses the custom domain `mourningreport.pp.ua`. The domain
must already be active in the same Cloudflare account. To test on a
`workers.dev` hostname first, remove the custom-domain route from
`cloudflare/wrangler.jsonc` and enable `workers_dev`.

### 5. Traditional VPS deployment

The existing Windows/SQLite deployment remains:

```sh
poetry install
python run.py
```

For a VPS that should share PostgreSQL data with Cloudflare, use the isolated
uv project so the pure-Python PostgreSQL driver is installed without changing
the root Poetry lock or Windows build:

```sh
cd cloudflare
uv sync --group server
export DATABASE_URL='postgresql+pg8000://app_user:URL_ENCODED_PASSWORD@db-host:5432/app_db'
export SECRET_KEY='use-the-same-long-random-secret'
uv run --group server python ../run.py
```

Configure these variables in the VPS service manager rather than a shell
profile. Use HTTPS and set `COOKIE_SECURE=1`. The root Poetry workflow remains
SQLite-first; do not set `DATABASE_URL` in that environment unless you also
add a PostgreSQL driver and update the Poetry lock.

## Compatibility boundaries

- Tailscale Funnel and local SQLite backup jobs remain available only in normal
  server/desktop mode. Cloudflare uses its own routing and managed database
  backup facilities.
- The admin backup-download endpoint returns HTTP 501 for remote databases;
  use the PostgreSQL provider's backup/restore workflow.
- The SQLite migration path remains intact. PostgreSQL startup uses SQLAlchemy
  metadata creation plus portable compatibility migrations; validate against
  a staging database before pointing it at valuable data.
- Cloudflare Python Workers are a separate runtime from CPython. A successful
  local/VPS test does not replace the Worker smoke test.
