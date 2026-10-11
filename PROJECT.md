# Project: EasyMourningReport Modular Refactoring

## Architecture
Modular domain-separated FastAPI + SQLAlchemy application:
- `app/main.py`: Slim application factory (< 100 lines), lifespan management, middleware (SessionMiddleware + CSRF guard), static mount, master router inclusion.
- `app/db/`:
  - `base.py`: SQLAlchemy DeclarativeBase
  - `session.py`: Database engine, SessionLocal, get_db dependency, DB_PATH
  - `bootstrap.py`: Schema migrations & initial seeding
  - `backup.py`: SQLite streaming backup & background task
  - `models/`: Entity definitions (`store`, `user`, `product`, `report`, `audit`)
  - `repositories/`: Data access layer (`audit`, `products`, `stores`, `reports`)
- `app/core/`:
  - `paths.py`: Multi-OS path resolution with `_app_dir()` fallback
  - `security.py`: Password hashing, secret key, client IP, CSRF guard (`same_origin_post_guard`)
  - `ratelimit.py`: In-memory sliding window rate limiter
  - `ui.py`: Jinja2 environment, template helpers (`money`, `flash`, `done`, `render`)
  - `dependencies.py`: FastAPI route dependencies (`get_db`, `current_user`, `admin_required`, `store_required`, `admin_period`)
- `app/services/`:
  - `pricing.py`: Pure pricing calculations (`offered_prices`, `apply_price_change`, labels, normalization)
  - `excel.py`: Excel parsing (openpyxl import) & summary matrix generation
- `app/routes/`:
  - `pwa.py`: `/manifest.webmanifest`, `/sw.js`, `/offline`
  - `auth.py`: `/login` (GET/POST), `/logout` (POST)
  - `root.py`: `/` (GET)
  - `report.py`: `/report` (GET/POST)
  - `admin/`:
    - `dashboard.py`: `/admin` (GET)
    - `products.py`: `/admin/products/*` (POST: create, edit, delete, restore, import)
    - `stores.py`: `/admin/stores/*` (POST: create, edit, delete, restore, password)
    - `reports.py`: `/admin/reports/*` (GET list, GET detail, POST status)
    - `summary.py`: `/admin/summary` (GET), `/admin/summary.xlsx` (GET)
    - `logs.py`: `/admin/logs` (GET)
    - `security.py`: `/admin/password` (POST)

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---|---|---|---|
| 1 | Physical Code Movement & Slim main.py | Move all route code, slim main.py to < 100 lines | M1 | Survey 1, Survey 2 |
| 2 | Eliminate 9 Legacy Shims & Update Imports | Delete 9 shims, update imports in run.py, tests, and app | M1 | Survey 1, Survey 2 |
| 3 | Eliminate Duplicate `money` & Dynamic Hacks | Remove duplicate `money` in repositories/reports.py; remove sys.modules hacks | M1 | Survey 1, Survey 2 |
| 4 | Price Change Feature Support (R5) | Multiple prices per product/month in admin.html, dashboard, and backend | M2 | Survey 3 |
| 5 | PyOxidizer Packaging & Asset Copying (R6) | build.py with PyOxidizer, cross-compilation fix, copy templates & static to dist/ | M3 | Survey 3 |
| 6 | Multi-OS Automation & Fallbacks (R3) | start.bat (check dist/LegkyiZvit.exe), run.py (clean DB_PATH), ui.py & main.py asset fallback | M3 | Survey 3 |
| 7 | CSRF Guard Middleware Verification (R7) | same_origin_post_guard mounted and verified | M1, M4 | Survey 1, Survey 2 |
| 8 | pyproject.toml Dev Dependency Cleanup | Clean [dependency-groups] into [tool.poetry.group.dev.dependencies] with flake8 | M4 | Survey 3 |
| 9 | PEP 8 Import Trimming & Cleanup | Clean all unused imports, order stdlib -> 3rd party -> local across all .py files | M4 | Survey 1, Survey 3 |
| 10 | Documentation & Test Suite Completeness (R4) | DOCS.md & README.md updated for non-technical users, full test suite passing | M4 | Survey 2, Survey 3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | Shim Elimination & Core Cleanup | Delete 9 shims, update all imports in run.py & tests, eliminate duplicate money, slim main.py < 100 lines | None | COMPLETED |
| M2 | Price Change Polish (R5) | Pre-render extra prices in admin UI, add remove button, support N price changes cleanly | M1 | COMPLETED |
| M3 | PyOxidizer & Multi-OS Automation (R3, R6) | build.py PyOxidizer packaging to dist/, asset fallbacks in ui.py & main.py, start.bat & run.py fixes | M1 | COMPLETED |
| M4 | Dependencies, Imports, Docs & Tests (R4, Follow-up) | pyproject.toml dev group, import trimming, admin backup snapshot download, DOCS.md & README.md, full test pass | M2, M3 | IN PROGRESS |

## Interface Contracts
### `app/db`
- Exports: `Base`, `engine`, `SessionLocal`, `get_db`, `DB_PATH`, `BASE_DIR`, and models (`Store`, `User`, `Product`, `ProductPrice`, `Report`, `ReportItem`, `AuditLog`).
- No circular dependencies between models or repositories.

### `app/core`
- `ui.py`: `money(cents: int) -> str` is the canonical formatter. Used across UI templates and repositories.
- `paths.py`: `data_dir() -> Path`, `_app_dir() -> Path`.
- `security.py`: `same_origin_post_guard(request: Request, call_next)`.

### `app/routes/admin`
- All admin endpoints depend on `Depends(admin_required)` and `Depends(get_db)`. No dependency dictionaries.

## Code Layout
- All application code resides in `app/`.
- Entrypoints: `run.py`, `start.bat`, `flake.nix`.
- Packaging: `build.py`, `pyoxidizer.bzl` -> `dist/LegkyiZvit.exe`.
- Tests: `tests/` (12 test suites).
