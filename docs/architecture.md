# Architecture

One Python process (`python -m app`, run from `backend/`) serves the REST API and the compiled React app. The code is split into a **platform** that every feature uses and **feature modules** that each live in one folder on the backend and one on the frontend. Adding a feature means adding those two folders and one line in each registry. The core is not edited.

```text
backend/app/
├── main.py, __main__.py   # composition and the single launcher
├── core/                  # infrastructure: module contract, security, paths, errors, periods, tunnel…
├── db/                    # engine/session, backups, migration runner, bootstrap
├── platform/              # features every module relies on
│   ├── accounts/          # organisations, users, roles, permissions, sign-in, access checks
│   ├── audit/             # audit log
│   ├── system/            # backups, tunnel, Tailscale endpoints
│   ├── module.py          # the platform described as a Module
│   └── registry.py        # platform + installed modules (the only platform file that loads modules)
├── modules/
│   ├── __init__.py        # INSTALLED_MODULES = (reports, transport)
│   ├── reports/           # models, schemas, routes, permissions, migrations, seed, tests
│   └── transport/         # scaffold and template for new modules
└── routes/                # PWA files, legacy form sign-in, SPA fallback, router composition

frontend/src/
├── app/                   # shell: App.tsx, layout, login page, routing, registry.ts
├── platform/              # API client, auth, i18n, theme, offline drafts, module contract,
│                          # access (users/orgs/roles), settings host, audit log, system settings
├── ui/                    # design-system primitives
└── modules/
    ├── index.ts           # installedModules = [reportsModule, transportModule]
    ├── reports/           # module.tsx, api.ts, permissions.ts, i18n.ts, pages/, settings/, components/
    └── transport/         # scaffold
```

## Module contract

**Backend** (`app/core/modules.py`). A module exposes `module = Module(...)` from its package with:

| Field | Purpose |
|---|---|
| `router` | `APIRouter` mounted under `/api/v1` (new modules use `/api/v1/<name>/…`) |
| `permissions` | `Permission(code, label, scope, description)`; they appear in the role editor automatically |
| `models` | SQLModel table classes, so the tables are created and detected by the migration runner |
| `migrations` | `Migration(id, apply)`; ids are prefixed with the module name |
| `audit_actions` | Audit action names offered as log filters |
| `default_grants` | Permissions a newly created built-in role receives, e.g. `{"store": ("reports.submit",)}` |
| `organisation_usage` | `db -> {organisation_id: count}`. An organisation with data in any module is archived instead of deleted |
| `seed` | Demo data for `DEMO=1` on an empty database |

**Frontend** (`src/platform/modules.ts`). A module exports an `AppModule` from `module.tsx` with `routes` (shell pages relative to `/admin`, or standalone absolute paths), `nav` items, `settings` sections (tabs in «Налаштування»), and `landing` pages with priorities. Every entry lists the permission codes that unlock it. The shell builds routing, navigation, the settings page and the post-login redirect from these lists.

**Boundaries** (enforced by `backend/app/tests/test_import_architecture.py` and `frontend/src/app/registry.test.ts`):

- A module may import `core`, `db` and `platform`, never another module.
- `core`, `db`, `platform` and `routes` never import a module. `platform/registry.py` is the one exception, and it loads them lazily.
- On the frontend, `platform/` and `ui/` never import `modules/` or `app/`. Platform pages receive the composed registry through `ModuleRegistryContext`.

### Adding a module, e.g. transport orders

1. Backend: fill in `app/modules/transport/` with `models.py`, `schemas.py`, `routes.py` and tests. Add the table classes to `models=`. Protect each route with `Depends(require(...))` or `Depends(require_member(...))` from `app.platform.accounts.access`. Scope organisation data with `principal.organisation_id`.
2. Frontend: add pages under `src/modules/transport/pages/` and list them in `module.tsx`.
3. Run `npm run gen:api` (from `frontend/`) to refresh the DTO types, then add aliases in `src/platform/api/types.ts`.
4. Grant the new permissions to roles in «Користувачі → Ролі». Optionally set `default_grants` for built-in roles.
5. A completely new module only needs `INSTALLED_MODULES` (backend) and `installedModules` (frontend) updated.

## Accounts and access

- **Organisation**: a customer-side unit. Every store from earlier releases became one. It can have many users. Archived organisations keep their data, and their users cannot sign in.
- **User**: `organisation_id = NULL` means platform staff, who act across organisations. Users can be disabled (`active = false`).
- **Role**: a named permission set with a scope (`platform` or `organisation`). Organisation roles can be shared by all organisations or limited to one. A user may hold several roles.
  - Built-in **Адміністратор** (`platform_admin`) and **Адміністратор організації** (`org_admin`) always hold every permission of their scope, including permissions of modules installed later.
  - Built-in **Магазин** (`store`) is editable and starts with `reports.submit`.
- **Effective permissions** are the union of the user's roles that match their scope (`app/platform/accounts/access.py`).
- **Escalation guards**: organisation managers (`org.users.manage`) only see and edit their own organisation, and only hand out roles whose permissions they hold themselves. The last active platform administrator cannot be disabled, demoted or deleted.

| Permission | Scope | Unlocks |
|---|---|---|
| `platform.organisations.manage` | platform | Organisations |
| `platform.users.manage` | platform | All user accounts |
| `platform.roles.manage` | platform | Role editor |
| `platform.audit.view` | platform | Audit log |
| `platform.system.manage` | platform | Backups, tunnel, Tailscale |
| `org.users.manage` | organisation | Own organisation's users |
| `reports.submit` | organisation | Fill and submit own monthly report |
| `reports.review` | platform | Summary, report list/detail, lock/unlock, Excel |
| `reports.catalog.manage` | platform | Products and prices |
| `reports.settings.manage` | platform | «По розрахунку» per organisation |
| `transport.orders.create` | organisation | Reserved: place transport orders |
| `transport.orders.view_all` | platform | Reserved: see all orders |
| `transport.orders.manage` | platform | Reserved: process orders |

## Persistence and migrations

SQLite stays the default. `LEGKYI_DATA_DIR` and `LEGKYI_BACKUPS_DIR` resolve the persistent folders, and Compose bind-mounts them to `./data` and `./backups`.

`app/db/migrations.py` applies each module's migrations once, in registry order, and records them in `schema_migrations`:

- A module whose tables do not exist yet is baselined: `create_all` builds it and its migrations are only recorded.
- Otherwise pending migrations run in order, each in its own transaction, before `create_all`. A migration that needs a new table creates it itself.
- A `before-migrate` backup is taken before the first pending migration.

The upgrade from the single-role release (`platform.0001_organisations_and_roles`, `reports.0002_settings_table`):

- renames `stores` to `organisations` (SQLite rewrites the foreign keys) and `users.store_id` to `organisation_id`;
- gives former admins the «Адміністратор» role and former store logins the «Магазин» role, then drops `users.role`;
- moves `stores.calculation_enabled` into the reports-owned `report_settings` table.

Logins, passwords, reports and settings are preserved. `backend/app/tests/test_migrations.py` replays the exact previous-release schema.

`deploy/Dockerfile` builds the frontend and Python runtime in separate stages. `deploy/compose.yaml` defines the web app and a `backup` sidecar. Keep the data and backup mounts unchanged when updating.

## Verification commands

```bash
# backend
uv run --locked pytest

# frontend
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```
