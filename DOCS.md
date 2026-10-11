# 📖 EasyMourningReport (Легкий звіт) — Architecture & Developer Documentation

## 1. Project Overview & Purpose

**EasyMourningReport** («Легкий звіт») is a multi-OS web application and PWA designed for retail store networks. It enables stores to submit monthly inventory and sales reports by quantity, while centralized administrators manage products, prices, stores, account credentials, and review consolidated financial summaries.

### Key Capabilities
- **Role-based Workflow**: Store managers submit quantity-based monthly reports. Administrators manage products, store accounts, price revisions, and view unified reporting matrices.
- **Two-Price Revaluation Support**: When a product's price changes within a month, both old and new prices are offered in report forms and summary matrices. Multiple price revisions within a single month are supported dynamically.
- **Zero Data Loss Archiving**: Deleting stores or products that already have historical reports moves them to an archive rather than cascading deletions, keeping report history intact.
- **Multi-OS Automation**: Runs out-of-the-box on Linux / NixOS (via `flake.nix`) and Windows (via `start.bat`), integrating Tailscale Funnel for public HTTPS access without firewall configuration.
- **Online SQLite Persistence**: Zero external database dependency; utilizes SQLite with online background backups, retention rotation, and idempotent migrations.

---

## 2. Directory Structure

```text
EasyMourningReport/
├── run.py                          # 🚀 Application entrypoint (uvicorn runner)
├── start.bat                       # 🪟 Windows Tailscale Funnel + server startup script
├── flake.nix                       # 🐧 Nix/NixOS flake for reproducible environments
├── pyproject.toml                  # 📦 Poetry project configuration & dependencies
├── poetry.lock                     # 🔒 Pinned dependency versions
├── build.py                        # 🛠️ Standalone executable build script (PyOxidizer)
├── pyoxidizer.bzl                  # ⚙️ PyOxidizer build configuration
├── DOCS.md                         # 📖 Developer and architecture documentation
├── README.md                       # 📄 Project README and quickstart guide
│
├── backups/                        # 🗄️ SQLite online snapshot backups (reports-*.db)
├── tests/                          # 🧪 Comprehensive test suite
│   ├── test_backup.py              # SQLite online backup and retention tests
│   ├── test_core.py                # Core dependencies, UI helpers, and backward shims
│   ├── test_migrations.py          # Schema migrations and legacy upgrade tests
│   ├── test_paths.py               # Data directory resolution tests
│   ├── test_pricing.py             # Pricing rules and login normalisation tests
│   ├── test_ratelimit.py           # Login throttling and brute-force protection tests
│   ├── test_report_lines.py        # Report lines calculation and summary integration
│   ├── test_repositories.py        # Data access layer and repositories tests
│   ├── test_routes.py              # Modular ASGI route integration and CSRF tests
│   ├── test_security.py            # CSRF guard and cryptographic hash tests
│   ├── test_services.py            # Pricing and Excel export/import service tests
│   └── test_templates.py           # Jinja2 template rendering tests
│
└── app/                            # 📦 Core application package
    ├── __init__.py
    ├── main.py                     # ⚡ FastAPI app factory, lifespan, global middleware
    │
    ├── core/                       # 🔧 Infrastructure utilities
    │   ├── __init__.py
    │   ├── paths.py                # Multi-OS persistent data directory resolution
    │   ├── security.py             # PBKDF2 hashing, secret key generation, CSRF guard
    │   ├── ratelimit.py            # Sliding window in-memory brute-force limiter
    │   ├── ui.py                   # Jinja2 template environment, flash, redirect, errors
    │   └── dependencies.py         # FastAPI dependency injection & request validation
    │
    ├── db/                         # 🗄️ Dedicated SQLAlchemy database package
    │   ├── __init__.py             # Public database API (Base, engine, SessionLocal, get_db)
    │   ├── base.py                 # DeclarativeBase definition
    │   ├── session.py              # Engine creation and SessionLocal factory
    │   ├── bootstrap.py            # PRAGMA schema migrations and initial seeding
    │   ├── backup.py               # SQLite online streaming backup & async worker
    │   │
    │   ├── models/                 # 🏛️ Granular ORM models
    │   │   ├── __init__.py         # Model re-exports for foreign key resolution
    │   │   ├── store.py            # Store ORM entity
    │   │   ├── user.py             # User ORM entity
    │   │   ├── product.py          # Product & ProductPrice ORM entities
    │   │   ├── report.py           # Report & ReportItem ORM entities
    │   │   └── audit.py            # AuditLog ORM entity
    │   │
    │   └── repositories/           # 🔍 Data Access Layer (DAL)
    │       ├── __init__.py
    │       ├── audit.py            # Audit log recording & actions
    │       ├── products.py         # Price history and product query helpers
    │       ├── stores.py           # Store validation and period lookups
    │       └── reports.py          # Report calculation, lines, and summary matrix
    │
    ├── services/                   # ⚙️ Domain business logic (DB-decoupled)
    │   ├── __init__.py
    │   ├── pricing.py              # Price calculation, labels, and login normalisation
    │   └── excel.py                # Excel workbook parsing (.xlsx) and summary generation
    │
    ├── routes/                     # 🌐 Modular route endpoints
    │   ├── __init__.py             # Aggregated api_router
    │   ├── root.py                 # GET / (role-based redirect)
    │   ├── pwa.py                  # PWA manifests and service worker (/sw.js, etc.)
    │   ├── auth.py                 # Authentication endpoints (/login, /logout)
    │   ├── report.py               # Store reporting endpoints (/report)
    │   │
    │   └── admin/                  # 🛡️ Administrator route endpoints
    │       ├── __init__.py         # Admin aggregated router
    │       ├── dashboard.py        # GET /admin overview
    │       ├── products.py         # Product CRUD, multi-price edit, and Excel import
    │       ├── stores.py           # Store CRUD, archiving, and password updates
    │       ├── reports.py          # Report review, locking, and unlocking
    │       ├── summary.py          # Monthly summary web page and .xlsx download
    │       ├── logs.py             # Action audit log viewer
    │       └── security.py         # Admin master password reset
    │
    ├── static/                     # 🎨 Static web assets (CSS, icons, manifests)
    └── templates/                  # 📑 Jinja2 HTML templates
```

---

## 3. Setup and Running

### 3.1 Direct Execution (Poetry)
```bash
# 1. Install dependencies
poetry install

# 2. Run the application server
poetry run python run.py
```
The server will bind to `http://127.0.0.1:8000` by default.

### 3.2 Linux / NixOS (Flake)
```bash
# Enter nix development shell
nix develop

# Or run the automated serve pipeline with Tailscale Funnel
nix run .#serve
```

### 3.3 Windows Automation (`start.bat`)
Double-click `start.bat` or run from cmd/PowerShell:
```bat
start.bat
```
`start.bat` automatically:
1. Detects whether Tailscale is installed and configures `tailscale funnel --bg 8000`.
2. Starts either the standalone executable `LegkyiZvit.exe` or `poetry run python run.py`.
3. Opens the browser to the local or Funnel URL.

---

## 4. Multi-OS Automation Flow

```text
[Internet / Store Tablets]
           │
           ▼
[Tailscale Funnel (Public HTTPS)]
           │ (Proxies traffic)
           ▼
[127.0.0.1:8000 (Uvicorn HTTP)]
           │
           ▼
[FastAPI App (app/main.py)]
  ├── Global CSRF Guard: same_origin_post_guard
  ├── Signed SessionMiddleware
  └── Modular Routers (app/routes/)
```

### Path Resolution
The app uses `app/core/paths.py:data_dir()` to place data (`reports.db`, `secret.key`, `backups/`):
1. If environment variable `LEGKYI_DATA_DIR` is set, that folder is used.
2. Otherwise, the folder next to the executable (or project root when run from source) is used.
3. If that folder is read-only (e.g. Program Files), `%LOCALAPPDATA%\LegkyiZvit` (Windows) or `~/.local/share/LegkyiZvit` (Linux) is used.

---

## 5. Database Layer Architecture

The database layer resides under `app/db/`:
- **Engine & Session**: `app/db/session.py` initializes SQLite with thread-safety disabled for async compatibility (`check_same_thread=False`). `get_db()` provides a request-scoped dependency.
- **Declarative Base**: `app/db/base.py` defines `Base(DeclarativeBase)`.
- **Granular Models**: Each entity is defined in `app/db/models/`:
  - `Store`: Store entity with name and soft-deletion `archived` flag.
  - `User`: Accounts with role (`admin` or `store`), password hash, and store relation.
  - `Product`: Product entity with name, cached current price, active, and archived flags.
  - `ProductPrice`: Historical pricing records with periods (`"0000-00"` for initial price, `"YYYY-MM"` for changes, and `"YYYY-MM_N"` for multi-price revisions).
  - `Report` & `ReportItem`: Monthly submission drafts and locked reports.
  - `AuditLog`: Security audit trails.
- **Repositories (DAL)**: `app/db/repositories/` houses data operations so that route handlers remain concise and business-focused.
- **Migrations**: `app/db/bootstrap.py` performs safe PRAGMA checks and adds missing columns/tables on startup without requiring Alembic.
- **Backups**: `app/db/backup.py` leverages SQLite's online streaming backup API (`src.backup(dst)`) to snapshot the database safely while the server is running.

---

## 6. Route Organization & Adding Endpoints

All endpoints are modularized under `app/routes/`:
- `app/routes/pwa.py`: Web app manifests and offline routes.
- `app/routes/auth.py`: Authentication forms and session handling.
- `app/routes/root.py`: Role-based entry redirection.
- `app/routes/report.py`: Monthly report submission for stores.
- `app/routes/admin/`: Admin endpoints divided by functional domain (`dashboard`, `products`, `stores`, `reports`, `summary`, `logs`, `security`).

### Adding a New Endpoint
1. Create or select a submodule under `app/routes/` (or `app/routes/admin/`).
2. Define routes using an `APIRouter()` instance:
   ```python
   from fastapi import APIRouter, Depends
   from app.core.dependencies import admin_required

   router = APIRouter()

   @router.get("/admin/my-feature")
   def my_feature(user = Depends(admin_required)):
       return {"ok": True}
   ```
3. Include the router in `app/routes/admin/__init__.py` or `app/routes/__init__.py`.

---

## 7. Testing

The project uses pytest for unit tests and FastAPI HTTP integration tests (via `TestClient`). The suite must pass and keep application branch coverage at or above 95%:
```bash
poetry run pytest --cov=app --cov-branch --cov-fail-under=95
```

In the Nix development shell, the `test` command runs this same gate. The Windows packaging workflow is manual-only; it restores the pip cache, runs the test gate, and builds the executable only after tests pass.

### Test Suites Included:
- `test_backup.py`: Verifies online backups, changes skipping, and snapshot retention.
- `test_core.py`: Validates core dependencies, UI formatting, redirects, and backward shims.
- `test_migrations.py`: Verifies database upgrades from legacy schemas.
- `test_paths.py`: Tests data directory discovery across OS environments and overrides.
- `test_pricing.py`: Unit tests for price-history mechanics and login normalisation.
- `test_ratelimit.py`: Tests brute-force login throttling across IPs and user pairs.
- `test_report_lines.py`: Tests report generation with two price rows during change months.
- `test_repositories.py`: Verifies data access repositories and queries.
- `test_routes.py`: Comprehensive ASGI integration tests for all routes and CSRF protection.
- `test_security.py`: Direct unit tests for CSRF rejection and referer acceptance.
- `test_services.py`: Tests Excel matrix generation and multi-price support.
- `test_templates.py`: Verifies Jinja2 compilation and rendering of all pages.

---

## 8. Building a Packaged Application (PyOxidizer)

The project uses PyOxidizer 0.24, whose bundled CPython distribution is Python 3.10. Keep the executable and its runtime resource directory together.

### Building on Windows

```powershell
python -m pip install pyoxidizer==0.24.0
python build.py
```

The build script stages a complete runnable distribution:
- `dist/LegkyiZvit.exe`
- `dist/lib/` — Python modules and extension modules.
- `dist/app/` — Jinja templates and static/PWA assets.

Do not copy the EXE by itself. Keep both `lib/` and `app/` beside it. Run it from the extracted `dist/` directory (or run `start.bat` from the project root, which detects `dist/LegkyiZvit.exe`). The manual package workflow first runs pytest with a 95% coverage gate, then builds the distribution, requests `/login`, CSS, and the PWA manifest, and verifies that the database and secret key persist after a restart.

### Runtime data

`reports.db`, `secret.key`, and `backups/` are created beside the executable by default. If that directory is read-only, the app falls back to `%LOCALAPPDATA%\\LegkyiZvit` on Windows or `~/.local/share/LegkyiZvit` on Linux. Set `LEGKYI_DATA_DIR` to choose a different persistent data folder. The app prints the selected folder at startup.

### Compatibility

PyOxidizer 0.24 officially targets CPython 3.8–3.10. The application code and dependency pins in `pyoxidizer.bzl` therefore remain compatible with Python 3.10, while normal development can use a newer Python version.

---

## 9. Configuration & Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Network interface for Uvicorn |
| `PORT` | `8000` | Port for Uvicorn |
| `LEGKYI_DATA_DIR` | None | Explicit folder override for database, secret key, and backups |
| `ADMIN_PASSWORD` | Auto-generated | Initial password for the `admin` account on first startup |
| `COOKIE_SECURE` | `0` | Set to `1` when served behind HTTPS (enables `https_only` cookies) |
| `BACKUP_KEEP` | `100` | Maximum number of snapshot backup files to retain |
| `BACKUP_EVERY_MIN` | `60` | Background backup check interval in minutes |
| `SECRET_KEY` | Read from `secret.key` | Session signing secret key override |
| `DEMO` | None | Set to `1` to seed sample products and stores on first launch |

---

## 10. Security Architecture

1. **Production CSRF Protection**: `same_origin_post_guard` is mounted as global HTTP middleware on FastAPI. Every `POST` request must supply a valid `Origin` or `Referer` matching the `Host` header.
2. **Password Security**: Passwords are hashed using `PBKDF2-HMAC-SHA256` with 200,000 iterations and 16 bytes of cryptographically secure random salt.
3. **Login Brute-Force Rate Limiting**: In-memory sliding window throttling limits failed attempts per IP, per login, and per (IP, login) pair (5 failed attempts per pair triggers a cooldown).
4. **Session Management**: Session cookies are signed with HMAC using a persistent key stored in `secret.key`.
5. **Report Tamper Resistance**: Price lines submitted by store browsers are strictly verified against server-computed allowed prices for the given month. Prices coming from client payloads are never trusted blindly.
