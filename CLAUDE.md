# EasyMourningReport (Легкий звіт)

Internal platform for a burial-service business: organisations (stores) with multiple users, roles and permissions, and feature modules (monthly reports; transport orders scaffolded). One Go binary (stdlib `net/http`, SQLite via `modernc.org/sqlite`) serves the REST API and an embedded React 18 + Vite + Tailwind SPA. UI language is Ukrainian (`uk-UA`). The backend was ported from Python in 2026 (see `docs/adr/0004-port-backend-to-go.md`); the last Python release is commit `92564ef`.

## Commands

Run from the repository root unless noted.

```bash
cd frontend && npm ci && npm run build   # SPA -> internal/assets/static/app/ (embedded into the binary; gitignored)
go run ./cmd/server                      # dev server on 127.0.0.1:8000 (build the SPA first)
go vet ./cmd/... ./internal/... && go test ./cmd/... ./internal/...   # NOT ./... (it descends into node_modules)
bash scripts/build_go.sh                 # single-file dist/legkyi.exe (windows) and dist/legkyi (linux), cloudflared bundled (-tags bundle)

cd frontend && npm run lint && npm run typecheck && npm test && npm run build
npm run dev                              # app at :5173, proxies /api etc. to :8000 (BACKEND_URL overrides)
```

- `go build` fails if `internal/assets/static/` is missing; without `static/app/` (the Vite build) the binary starts but serves no UI. Web tests use a stub SPA and do not need the build.
- `bash scripts/build_go.sh && go run ./cmd/smoke -exe dist/legkyi -tunnel && CHROMIUM_PATH=/opt/pw-browsers/chromium LEGKYI_E2E_BINARY=dist/legkyi uv run scripts/e2e_test.py` drives the real binary in a browser (port 8888, `DEMO=1`, throwaway data dir). Run it after UI or navigation changes. `LEGKYI_E2E_BINARY` overrides the binary path.
- There is no CI; the commands above are the whole verification gate. Run the relevant ones before committing.

## Architecture (read docs/architecture.md before structural changes)

- **Packages** (`internal/`): `config` (env, data/backup paths), `store` (SQLite open, schema, backups), `core` (the `Module` contract), `platform` (accounts, roles, permissions rules, principal, bootstrap, audit), `reports` (feature module: catalogue, pricing, money, XLSX), `transport` (module scaffold), `system` (cloudflared supervisor, health), `registry` (installed modules), `web` (HTTP: router, sessions, CSRF, handlers), `assets` (embedded static files + SPA). `cmd/server/main.go` wires it all.
- **Module contract:** Go `core.Module` (permissions, audit actions, default grants, organisation usage, seed, overview), listed in `internal/registry/registry.go`; frontend `src/platform/modules.ts` (`AppModule`: routes, nav, `admin` sections, landing), listed in `frontend/src/modules/index.ts`. Never hardcode a feature into the shell.
- **Boundaries:** a module package never imports another module; `core`, `store`, `platform`, `web` never import a module package (only `registry` and `cmd/server` do). Frontend `platform/` and `ui/` never import `modules/` or `app/`.
- **Access control:** every `/api/v1` route is registered through `a.authed(codes, h)` or `a.member(codes, h)` (`internal/web/app.go`). Organisation-scope permissions must only touch `p.User.Org`'s data. Platform users have no organisation. Frontend gates with `permissions` on routes/nav and `useAuth().can(...)`. Permission codes live in each Go module's `module.go` and are mirrored in the frontend module's `permissions.ts`.
- **Schema:** `internal/store/schema/fresh.sql` is the fresh-database DDL; missing tables are created on start. The Go code does not carry the legacy Python upgrade code: `store.RequiredMigrations` must already be recorded, otherwise start fails with a hint to run the last Python release once. A new table or column needs: DDL in `fresh.sql`, an idempotent create/alter step in `internal/store/schema.go`, and a test that opens a copy of an existing database (`store_test.go`, snapshots in `testdata/schema/`). Production data exists; never change a table in a way an existing database cannot take.
- **Writes:** one writer connection, all mutations inside `a.write(ctx, func(tx))`; use only the `*sql.Tx` inside (opening another transaction deadlocks).
- **Fixtures:** `testdata/contracts/*.json` (HTTP scenarios), `testdata/reports/` (money, pricing, XLSX golden files), `testdata/passwords/`, `testdata/schema/` are frozen output of the Python implementation. Change them only when behaviour changes on purpose, and say why.
- Database: SQLite in-process by design (docs/adr/0003-keep-sqlite.md).
- Public access is Cloudflare Tunnel only, supervised by the app (`internal/system/tunnel.go`). Bundled builds (`-tags bundle`, `internal/tunnelbin`) embed a pinned cloudflared, extract it to `<data>/tunnel/` and turn the tunnel on once at first start; plain builds (Docker, `go run`) use `CLOUDFLARED_PATH` or PATH. Update the version and both SHA-256 in `scripts/build_go.sh` together with `tunnelbin.Version`. Data, `.env`, backups and the tunnel state live next to the exe when it is writable. Backups run in-app.
- Figures (money, quantities, months) use `.figure` / `font-mono`: Literata with tabular numerals, not a code font. Interface text is IBM Plex Sans. Pages are `ui/PageHeader` + `ui/LedgerSection` (ruled, flat; see docs/design-system.md). Months use `ui/PeriodPicker` (Ukrainian), on/off settings `ui/Switch`, never native month/file controls (they render in the browser's language).
- Tailwind colours are CSS variables wrapped by `token()` in `tailwind.config.js` so opacity modifiers (`bg-primary/10`) work; keep new colours in that form.
- `frontend/src/platform/api/schema.d.ts` is maintained by hand (no OpenAPI export any more). Update it with every API shape change.

## UI and copy

- Read `docs/ux-contract.md` and `docs/design-system.md` before UI work. CSS custom properties in `frontend/src/app/index.css` are the token source; Tailwind consumes them. Reuse `frontend/src/ui/*` primitives.
- User-facing strings are Ukrainian: shared ones in `frontend/src/platform/i18n.ts`, module ones in the module's `i18n.ts` (which spreads `ukPlatform`). Use the shared number/date/money helpers.
- Target WCAG 2.2 AA: 44px touch targets, visible focus, labelled icon-only buttons, reduced-motion support, light/dark/system themes.

## Data safety

- Never delete, rename, or rewrite `data/`, `backups/`, `reports.db`, or `secret.key`. Don't read or print `.env`.
- Money is stored in integer cents (`*_cents`). Report periods are `YYYY-MM` strings.
- Release: run the **Release exe** workflow (Actions → Run workflow). It builds, tests and publishes `legkyi.exe`. See `.github/workflows/release.yml`.
