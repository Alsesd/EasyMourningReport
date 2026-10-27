# Project: EasyMourningReport Refactor & Modernization

## Architecture
- **Application Core**: FastAPI application structured into modular vertical slices under `app/features/` with shared cross-cutting concerns in `app/core/`.
- **Composition Root**: `app/main.py` runs schema bootstrap/seeding, the background backup loop, and tunnel lifecycle, then mounts all feature routers under `/api/v1` along with public and download routes.
- **Database Layer**: PostgreSQL via SQLModel and SQLAlchemy with modern driver `psycopg[binary]` (`postgresql+psycopg://` dialect), using environment-based configuration (`DATABASE_URL`, `POSTGRES_*`).
- **Package Management**: Standard PEP 621 metadata backed by `hatchling` (`build-backend = "hatchling.build"`), managed deterministically with `uv` and tracked via `uv.lock`.
- **Infrastructure**: Multi-stage Docker build, Docker Compose with persistent `pgdata` volume and healthcheck for PostgreSQL, NixOS flake development shell with `pkgs.uv`.
- **Cache Policy**: Strict cache suppression via pytest `-p no:cacheprovider -ra` and `PYTHONDONTWRITEBYTECODE=1` enforced across all runtimes, entry points, and CI workflows.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | PDM Removal | Delete `pdm.lock`, `.pdm-python`, and all `[tool.pdm]` / `pdm-backend` sections in `pyproject.toml`. | M1 | ORIGINAL_REQUEST §R1 |
| 2 | PEP 621 & Hatchling Packaging | Configure `pyproject.toml` using PEP 621 metadata, `hatchling` build backend, and `packages = ["app"]`. | M1 | ORIGINAL_REQUEST §R1 |
| 3 | uv Dependency Resolution | Generate deterministic `uv.lock`, verify with `uv lock --check`, and install via `uv sync`. | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Toolchain uv Migration | Update `docker/Dockerfile`, `.github/workflows/ci.yml`, `flake.nix`, and `frontend/package.json` (`gen:api`) for uv. | M1 | ORIGINAL_REQUEST §R1 |
| 5 | PostgreSQL Engine & Connection | Replace SQLite engine in `session.py` with PostgreSQL `psycopg` driver, `DATABASE_URL` resolver, and scheme auto-normalization. | M2 | ORIGINAL_REQUEST §R2 |
| 6 | Dialect-Agnostic Bootstrap | Replace SQLite PRAGMAs and `sqlite_master` in `bootstrap.py` with `sqlalchemy.inspect`, `DEFAULT FALSE`, and named parameters. | M2 | ORIGINAL_REQUEST §R2 |
| 7 | PostgreSQL Backup System | Replace SQLite file copying with `pg_dump` and programmatic table dump fallback producing `.sql` dumps in `backup.py`. | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Docker Compose PostgreSQL Service | Add healthy `postgres:16-alpine` service with `pgdata` volume and wire to `app` in `compose.yaml`. | M2 | ORIGINAL_REQUEST §R2 |
| 9 | Test Suite DB Adaptation | Unify database session fixture in `tests/conftest.py` supporting PostgreSQL and update dialect-specific tests. | M2 | ORIGINAL_REQUEST §R2 |
| 10 | Vertical Slice: Auth | Create `app/features/auth/` (User model, session/auth schemas, service, dependencies, routes). | M3 | ORIGINAL_REQUEST §R3 |
| 11 | Vertical Slice: Products | Create `app/features/products/` (Product/ProductPrice models, schemas, catalogue/pricing service, Excel import, routes). | M3 | ORIGINAL_REQUEST §R3 |
| 12 | Vertical Slice: Stores | Create `app/features/stores/` (Store model, schemas, store service, account linking, routes). | M3 | ORIGINAL_REQUEST §R3 |
| 13 | Vertical Slice: Reports | Create `app/features/reports/` (Report/ReportItem models, schemas, calculations, summary Excel generator, routes). | M3 | ORIGINAL_REQUEST §R3 |
| 14 | Vertical Slice: Audit | Create `app/features/audit/` (AuditLog model, schemas, audit service, routes). | M3 | ORIGINAL_REQUEST §R3 |
| 15 | Vertical Slice: Tunnel | Create `app/features/tunnel/` (Cloudflare Tunnel service and routes). | M3 | ORIGINAL_REQUEST §R3 |
| 16 | Composition Root & Core Clean | Maintain `app/main.py` as pure composition root; isolate cross-cutting concerns in `app/core/`. | M3 | ORIGINAL_REQUEST §R3 |
| 17 | Eliminate Tailscale Facade | Delete `app/core/tailscale.py`, `/admin/tailscale` routes, and purge legacy fallback branches in `tunnel.py`. | M4 | ORIGINAL_REQUEST §R4 |
| 18 | Purge Dead Code & Hooks | Eliminate obsolete SQLite hooks, duplicate helpers, and unneeded template wrappers. | M4 | ORIGINAL_REQUEST §R4 |
| 19 | Disable Bytecode & Test Caches | Configure pytest `-p no:cacheprovider -ra` and enforce `PYTHONDONTWRITEBYTECODE=1` in 7 critical runtime points. | M5 | ORIGINAL_REQUEST §R5 |
| 20 | Purge Cache Artifacts | Delete all existing `__pycache__`, `*.pyc`, and `.pytest_cache` folders across the repository. | M5 | ORIGINAL_REQUEST §R5 |
| 21 | Whole Repo Restructuring | Organize `docs/`, `docker/`, `scripts/`, `flake.nix`, `run.py`, and `app/__main__.py`. | M5 | ORIGINAL_REQUEST §R6 |
| 22 | Actualize Ignore Files | Update `.gitignore` and `.dockerignore` for uv, PostgreSQL `pgdata/`, secrets, and strict cache rules. | M5 | ORIGINAL_REQUEST §R7 |
| 23 | E2E Testing & Coverage Hardening | Build opaque-box E2E test suite (Tiers 1-4) and execute Tier 5 adversarial coverage hardening. | M6 | ORIGINAL_REQUEST §Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Package Management Migration | PDM removal, PEP 621 + Hatchling in `pyproject.toml`, `uv.lock`, Dockerfile, CI, flake.nix, frontend package.json | none | DONE |
| M2 | PostgreSQL Database Layer | Engine & Session (`psycopg`), `bootstrap.py` inspection, `backup.py` SQL dumps, `compose.yaml` PostgreSQL service, test DB fixtures | M1 | DONE |
| M3 | Vertical Slice Architecture | Modular vertical slices under `app/features/` (auth, products, stores, reports, audit, tunnel), `app/core/`, composition root `app/main.py` | M2 | DONE |
| M4 | Eliminate Redundant Code | Remove `tailscale.py`, `/admin/tailscale` endpoints, obsolete SQLite hooks, legacy tests | M3 | DONE |
| M5 | Cache Prevention & Repo Structuring | Disable caches (`-p no:cacheprovider`, `PYTHONDONTWRITEBYTECODE=1`), purge `__pycache__`, restructure `docs/`, `scripts/`, `run.py`, update `.gitignore`/`.dockerignore` | M4 | DONE |
| M6 | E2E Test Pass & Coverage Hardening | Pass 100% of E2E test suite (Tiers 1-4) and execute Tier 5 adversarial coverage hardening | M5 | DONE |

## Interface Contracts

### 1. `app.features.audit` (Leaf Interface)
- `record_audit(db: Session, request: Request, login: str, role: str, action: str, detail: str = "") -> None`: Appends immutable audit entry. Depends ONLY on `core.database` and `core.security.client_ip`. No other feature slice may be imported.

### 2. `app.features.auth` ↔ `app.features.stores`
- `create_store_user(db: Session, login: str, password: str, store_id: int) -> User`: Stores slice delegates user credential creation to auth.
- `update_store_user_login(db: Session, store_id: int, new_login: str) -> None`: Stores slice delegates login renames to auth.
- `reset_store_user_password(db: Session, store_id: int, new_password: str) -> None`: Stores slice delegates password resets to auth.
- `delete_store_user(db: Session, store_id: int) -> None`: Stores slice delegates user deletion to auth.

### 3. `app.features.reports` ↔ `app.features.products` & `app.features.stores`
- `count_product_reports(db: Session, product_id: int) -> int`: Used by `products.service` to decide between soft-archive vs hard-delete without querying Report models directly.
- `count_store_reports(db: Session, store_id: int) -> int`: Used by `stores.service` to decide between soft-archive vs hard-delete without querying Report models directly.

### 4. `app.features.products` ↔ `app.features.reports`
- `load_active_products(db: Session) -> list[Product]`: Used by reports line builder.
- `load_product_history(db: Session) -> dict[int, list[tuple[str, int]]]`: Used by reports summary builder.

### 5. `app.core.database` (Cross-Cutting DB Layer)
- `get_database_url() -> str`: Resolves normalized `postgresql+psycopg://` connection URL.
- `get_db() -> Generator[Session, None, None]`: FastAPI dependency yielding request-scoped session.
- `Base`, `engine`, `SessionLocal`: Shared SQLModel metadata and PostgreSQL engine.

### 6. `app.core.bootstrap` (Schema Lifecycle)
- `migrate() -> None`: Creates/upgrades the PostgreSQL schema using dialect-agnostic inspection and backs up legacy data before changes.
- `seed() -> None`: Creates the initial administrator and optional demo records.

## Code Layout
```text
EasyMourningReport/
├── app/
│   ├── __init__.py
│   ├── __main__.py               # Python module entry point (PYTHONDONTWRITEBYTECODE=1)
│   ├── main.py                   # FastAPI composition root mounting feature routers
│   ├── core/                     # Cross-cutting concerns only
│   │   ├── __init__.py
│   │   ├── database.py           # PostgreSQL engine, sessionmaker, get_db, Base
│   │   ├── bootstrap.py          # Schema migration, legacy upgrades, seeding
│   │   ├── schemas.py            # Shared DTO/mutation response envelopes
│   │   ├── validation.py         # Period, name and money normalisation
│   │   ├── security.py           # PBKDF2 hashing, load_secret, same-origin CSRF guard
│   │   ├── ratelimit.py          # Sliding-window IP throttling
│   │   ├── paths.py              # Application filesystem paths
│   │   ├── ui.py                 # Shared presentation & formatting helpers
│   │   ├── backup.py             # PostgreSQL backup management & route
│   │   └── pwa.py                # PWA manifest, service worker, offline shell
│   └── features/                 # Vertical domain slices
│       ├── auth/                 # models, schemas, service, dependencies, router
│       ├── products/             # models, schemas, pricing rules, catalogue service, router
│       ├── stores/               # models, schemas, store management service, router
│       ├── reports/              # models, schemas, calculation engine, summary Excel, router
│       ├── audit/                # models, schemas, audit service, router
│       └── tunnel/               # Cloudflare Tunnel service and router
├── docker/
│   ├── Dockerfile                # Multi-stage Docker build using uv and postgresql-client
│   └── compose.yaml              # Compose include wrapper for root compose.yaml
├── docs/                         # Architecture, API, testing, and deployment documentation
├── frontend/                     # React SPA client
├── scripts/                      # Utility scripts (OpenAPI generation)
├── tests/                        # Unit, integration, and opaque-box E2E tests
├── compose.yaml                  # Multi-service Compose (app + PostgreSQL with healthcheck)
├── flake.nix                     # Nix development shell using pkgs.uv
├── pyproject.toml                # PEP 621 metadata with hatchling build backend
├── uv.lock                       # Deterministic uv lockfile
└── run.py                        # Standalone application runner (PYTHONDONTWRITEBYTECODE=1)
```
