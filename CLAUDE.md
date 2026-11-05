# EasyMourningReport (Легкий звіт)

Internal platform for a burial-service business: organisations (stores) with multiple users, roles and permissions, and feature modules (monthly reports; transport orders scaffolded). FastAPI + SQLModel (SQLite) backend serving a React 18 + Vite + Tailwind SPA from one process. UI language is Ukrainian (`uk-UA`).

## Commands

Run from the repository root unless noted.

```bash
uv sync                                   # install backend deps (uv.lock is committed)
uv run --locked pytest                    # backend tests (platform: backend/app/tests, modules: backend/app/modules/*/tests)
cd backend && uv run --project .. python -m app   # dev server on 127.0.0.1:8000

cd frontend && npm ci
npm run lint && npm run typecheck && npm test && npm run build
npm run dev                               # app at :5173, proxies /api etc. to :8000 (BACKEND_URL overrides)
npm run gen:api                           # regenerate src/platform/api/schema.d.ts from OpenAPI
```

- `npm run build` writes to `backend/app/static/app/` (gitignored). The backend SPA-fallback test (`test_spa_fallback_serves_html`) needs that build to exist.
- `CHROMIUM_PATH=/opt/pw-browsers/chromium uv run --with playwright python scripts/e2e_test.py` drives the real app in a browser (port 8888, `DEMO=1`). Run it after UI or navigation changes.
- There is no CI; the commands above are the whole verification gate. Run the relevant ones before committing.

## Architecture (read docs/architecture.md before structural changes)

- **Platform + modules.** `backend/app/platform/` (accounts, roles/permissions, audit, system) and `frontend/src/platform/` are shared. Each feature is one self-contained folder: `backend/app/modules/<name>/` + `frontend/src/modules/<name>/`, registered in `backend/app/modules/__init__.py` and `frontend/src/modules/index.ts`. Scaffold a new one with `python3 scripts/new_module.py <name> --title "…"`.
- **Contracts:** backend `app/core/modules.py` (`Module`: router, permissions, models, migrations, audit actions, default grants, organisation usage, seed, overview); frontend `src/platform/modules.ts` (`AppModule`: routes, nav, `admin` sections for the «Адміністрування» hub, landing). Shell routing, nav and the hub are built from these. Never hardcode a feature into the shell.
- **Boundaries (tests enforce):** modules never import other modules; `core`/`db`/`platform`/`routes` never import modules (only `platform/registry.py`, lazily); frontend `platform/` and `ui/` never import `modules/` or `app/`. Import from the owning file, not package facades.
- **Access control:** every route uses `Depends(require("perm.code"))` or `require_member(...)` from `app.platform.accounts.access`. Organisation-scope permissions must only touch `principal.organisation_id`'s data. Platform users have `organisation_id = None`. Frontend gates with `permissions` on routes/nav and `useAuth().can(...)`. Permission codes are mirrored in each module's `permissions.ts`.
- **Schema changes:** add a `Migration` to the owning module (`migrations.py`, id `<module>.NNNN_name`). Migrations run before `create_all` and must create any new table they touch themselves. Never edit an applied migration. Production data exists: test upgrades like `backend/app/tests/test_migrations.py` does.
- Backend layering inside a module: routes → repo/service functions → models. Business rules stay out of routes where practical.
- The SPA catch-all in `routes/fallback.py` is registered last.
- Database: SQLite in-process by design (docs/adr/0003-keep-sqlite.md). Don't write ORM code that reassigns large relationship collections (SQLModel `__eq__` makes it quadratic); delete/insert rows instead.
- Public access is Cloudflare Tunnel only, supervised by the app (`platform/system/tunnel.py`). There is one container; backups run in-app.
- `font-mono` means aligned figures (Onest + tabular numerals), not a code font. Months use `ui/PeriodPicker` (Ukrainian), on/off settings `ui/Switch`, never native month/file controls (they render in the browser's language).
- Tailwind colours are CSS variables wrapped by `token()` in `tailwind.config.js` so opacity modifiers (`bg-primary/10`) work; keep new colours in that form.

## UI and copy

- Read `UX-CONTRACT.md` and `DESIGN.md` before UI work. CSS custom properties in `frontend/src/app/index.css` are the token source; Tailwind consumes them. Reuse `frontend/src/ui/*` primitives.
- User-facing strings are Ukrainian: shared ones in `frontend/src/platform/i18n.ts`, module ones in the module's `i18n.ts` (which spreads `ukPlatform`). Use the shared number/date/money helpers.
- Target WCAG 2.2 AA: 44px touch targets, visible focus, labelled icon-only buttons, reduced-motion support, light/dark/system themes.

## Data safety

- Never delete, rename, or rewrite `data/`, `backups/`, `reports.db`, or `secret.key`. Don't read or print `.env`.
- Money is stored in integer cents (`*_cents`). Report periods are `YYYY-MM` strings (`core/periods.py`).
- Production deploy is `docker compose up -d --build --remove-orphans` (one container); keep the `app_storage/` bind mounts unchanged.
