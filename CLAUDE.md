# EasyMourningReport (Легкий звіт)

Internal monthly store-report app for a burial-service business. FastAPI + SQLModel (SQLite) backend serving a React 18 + Vite + Tailwind SPA. UI language is Ukrainian (`uk-UA`).

## Commands

Run from the repository root unless noted.

```bash
uv sync                                   # install backend deps (uv.lock is committed)
uv run --locked pytest                    # backend tests (testpaths = backend/app/tests)
cd backend && uv run --project .. python -m app   # dev server on 127.0.0.1:8000

cd frontend && npm ci
npm run lint && npm run typecheck && npm test && npm run build
npm run dev                               # Vite, proxies /api and /static to :8000
npm run gen:api                           # regenerate src/platform/api/schema.d.ts from OpenAPI
```

- `npm run build` writes to `backend/app/static/app/` (gitignored). The backend SPA-fallback test (`test_spa_fallback_serves_html`) needs that build to exist.
- `scripts/e2e_test.py` drives the real app with Python Playwright on port 8888 with `DEMO=1`.
- There is no CI; the commands above are the whole verification gate. Run the relevant ones before committing.

## Architecture rules (enforced by tests)

- Backend: `main.py` only composes FastAPI; the sole launcher is `python -m app` (`__main__.py`).
- Import symbols from the module that owns them, never from package facades (`app.core`, `app.db`, `app.services`, `app.db.repositories`). Package `__init__.py` files stay empty of re-exports. See `backend/app/tests/test_import_architecture.py` and `test_api_router_structure.py`.
- Layers: `routes/` → `services/` → `db/repositories/` → `db/models/`. Business logic goes in `services/`, not routes.
- The SPA catch-all in `routes/fallback.py` is registered last so it never shadows `/api/*`, `/static/*`, backups, manifest, or service worker.
- Frontend: `app/` = shell/providers/layout, `platform/` = API client, auth, offline drafts, `ui/` = design-system primitives, `modules/<feature>/` = pages, `api.ts`, `i18n.ts`, tests. Pages call their module's `api.ts`; never hardcode endpoint paths in pages. New modules: `python scripts/new_module.py`.

## API contract changes

Changing a DTO in `backend/app/dto.py` or a route's response shape means: update `docs/API.md`, run `npm run gen:api`, update `frontend/src/platform/api/types.ts` aliases, and fix **both** backend tests and frontend test fixtures (recent commits show fixtures drifting from DTOs). Use the `api-contract-change` skill.

## UI and copy

- Read `UX-CONTRACT.md` and `DESIGN.md` before UI work. CSS custom properties in `frontend/src/app/index.css` are the token source; Tailwind consumes them. Reuse `frontend/src/ui/*` primitives.
- All user-facing strings go in `frontend/src/modules/reports/i18n.ts`, in Ukrainian. Use the shared number/date/money helpers.
- Target WCAG 2.2 AA: 44px touch targets, visible focus, labelled icon-only buttons, reduced-motion support, light/dark/system themes.

## Data safety

- Never delete, rename, or rewrite `data/`, `backups/`, `reports.db`, or `secret.key`. Don't read or print `.env`.
- Money is stored in integer cents (`*_cents`). Report periods are `YYYY-MM` strings (`core/periods.py`).
- Production deploy is `docker compose up -d --build` with a backup sidecar; keep the bind mounts unchanged.
