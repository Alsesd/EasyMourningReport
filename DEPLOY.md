# EasyMourningReport: two deployment targets

The existing app remains usable as a normal FastAPI service (including the
portable Windows/SQLite workflow) and has a separate Cloudflare Workers
entrypoint. This branch does not replace the desktop deployment.

## Deployment modes

| Mode | Entry point | Database | Static files |
|---|---|---|---|
| Local / VPS / Windows | `python run.py` or `uvicorn app.main:app` | SQLite by default; PostgreSQL when `DATABASE_URL` is set | FastAPI serves `app/static/` |
| Cloudflare Workers | `src/worker.py` via Pywrangler | PostgreSQL via `DATABASE_URL` secret | Cloudflare ASSETS binding backed by `app/static/` |

For both hosted deployments to share live data, configure the VPS and Worker
with the **same PostgreSQL database**. The existing SQLite file is not copied
to PostgreSQL automatically. Keep SQLite as the default for standalone Windows
installs unless you intentionally set `DATABASE_URL`.

## Cloudflare setup

### 1. Prerequisites

- A Cloudflare account and a domain managed by Cloudflare.
- Node.js, uv, and Python 3.13+ available on the deployment machine.
- A PostgreSQL database reachable from the Worker. Use a dedicated database
  and a restricted application user; provider-managed backups are recommended.

Python Workers run in Pyodide and support only compatible Python packages.
This adapter uses the pure-Python `pg8000` PostgreSQL driver. Treat the first
`pywrangler dev` run as a compatibility check for your selected PostgreSQL
provider and its network path; if direct database connections are unavailable,
configure Cloudflare Hyperdrive and validate the connection before production.

### 2. Configure secrets

Run from the repository root:

```sh
uv sync --group cloudflare
uv run --group cloudflare python scripts/bundle_templates.py
uv run --group cloudflare pywrangler secret put DATABASE_URL
uv run --group cloudflare pywrangler secret put SECRET_KEY
uv run --group cloudflare pywrangler secret put ADMIN_PASSWORD
```

For `DATABASE_URL`, use a SQLAlchemy URL, for example:

```text
postgresql+pg8000://app_user:URL_ENCODED_PASSWORD@db-host:5432/app_db
```

URL-encode special characters in the username/password. Use a long random
`SECRET_KEY` and keep it stable between deployments. Set `ADMIN_PASSWORD`
before first start so the initial admin password is not generated in logs.
Never commit real secrets or put them in `wrangler.jsonc`.

### 3. Verify locally, then deploy

```sh
uv run --group cloudflare python scripts/bundle_templates.py
uv run --group cloudflare pywrangler dev
```

Test login, product creation, price changes, monthly reports, Excel import/export,
and session cookies against the test database before deploying. The first app
startup creates the SQLModel schema and initial admin user. Do not point this
at production until the smoke test passes.

```sh
uv run --group cloudflare pywrangler deploy
```

The Worker config uses the custom domain `mourningreport.pp.ua`. The domain
must already be active in the same Cloudflare account. If you want to deploy
to a `workers.dev` URL first, remove the custom-domain route from
`wrangler.jsonc` and enable `workers_dev`.

### 4. Traditional VPS deployment

The existing command remains available:

```sh
poetry install
python run.py
```

To share data with the Worker, set `DATABASE_URL` and `SECRET_KEY` in the
VPS service environment before starting the app. Example:

```sh
export DATABASE_URL='postgresql+pg8000://app_user:URL_ENCODED_PASSWORD@db-host:5432/app_db'
export SECRET_KEY='use-the-same-long-random-secret'
python run.py
```

For production, set these variables in the service manager instead of a shell
profile. Use HTTPS and set `COOKIE_SECURE=1`.

## Compatibility boundaries

- Tailscale Funnel and local SQLite backup jobs remain available only in normal
  server/desktop mode. Cloudflare uses its routing and managed database backup
  facilities instead.
- The admin backup-download endpoint returns HTTP 501 for remote databases;
  use the PostgreSQL provider's backup/restore workflow.
- The app's existing SQLite migration path is retained. PostgreSQL startup uses
  SQLAlchemy metadata creation plus portable compatibility migrations; validate
  against a staging database before pointing it at valuable data.
- Cloudflare Python Workers are still a distinct runtime from CPython. A
  successful local/VPS test does not replace the Worker smoke test.
