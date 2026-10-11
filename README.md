# EasyMourningReport

A small FastAPI application for monthly product reports from multiple stores.

## Architecture

The application is a modular monolith: routes handle HTTP, services hold business
rules, repositories access persistence, SQLModel defines the database tables,
and Jinja templates/static assets render the UI.

```text
app/
├── core/          # Paths, security, validation, shared UI helpers
├── db/
│   ├── models/    # SQLModel table declarations by entity
│   ├── repositories/ # SQL queries and persistence operations
│   ├── session.py # Engine and request-scoped Session dependency
│   ├── bootstrap.py # Schema initialization and legacy SQLite migration
│   └── backup.py  # SQLite online backups
├── routes/        # Public, store, and admin HTTP routes
├── services/      # Pricing and Excel logic
├── templates/     # Jinja2 templates
├── static/        # CSS and PWA assets
├── main.py        # FastAPI application and lifespan
└── __main__.py    # Stable packaged entry point
```

## Database

SQLModel is used for ORM model declarations. Existing SQLAlchemy query expressions
remain usable because SQLModel is built on SQLAlchemy; the migration is intentionally
incremental so report calculations and historical price behavior do not change.

The packaged Windows application keeps SQLite as its default database so it remains
portable and does not require a separate database server. The database, secret key,
and backups are stored beside the executable when writable, otherwise under the
user's application-data directory. Do not delete `reports.db` or `secret.key`.

The current schema preserves these core concepts:

- `products`: canonical product catalogue and current price cache;
- `product_prices`: period-based price history;
- `stores`: stores with archive flags;
- `users`: admin/store login and password hash;
- `reports`: one report per store and month, with draft/submitted status;
- `report_items`: quantities and unit-price snapshots;
- `audit_log`: application audit events.

Schema creation and compatibility migration are run by the existing bootstrap layer.
Before changing schema fields, add a migration and tests against a copy of an existing
`reports.db`. Never test a destructive migration against the only production database.

## Install and run

Requires Python 3.10+ and Poetry.

```bash
git clone https://github.com/Alsesd/EasyMourningReport.git
cd EasyMourningReport
poetry install
python run.py
```

Open http://127.0.0.1:8000. On first launch the admin password is generated and printed
to the console unless `ADMIN_PASSWORD` is set.

## Tests

```bash
python -m unittest discover -s tests -v
python -m compileall -q app run.py tests
```

## Windows executable

The PyOxidizer build packages Python and dependencies into `dist/LegkyiZvit.exe` and
stages `dist/lib/`, `dist/app/templates/`, and `dist/app/static/` alongside it.
Do not move the executable away from these resources.

```powershell
python -m pip install pyoxidizer==0.24.0
python build.py
```

The CI smoke test starts the packaged executable, checks the login page and CSS, and
verifies that the SQLite database and session secret survive a restart.
