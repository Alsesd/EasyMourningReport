# UI Behavior and Implementation Map

This document records the current browser behavior and points to the code that owns it. Older server-rendered page templates and static page scripts have been removed; references to them are intentionally not used as current file paths. 

## Application shell and authentication

| Behavior | Current implementation |
|---|---|
| React router and route-level lazy loading | `frontend/src/app/App.tsx`, each module's `module.tsx` |
| Login form, validation feedback, and focus behavior | `frontend/src/app/pages/LoginPage.tsx` |
| Session loading, sign-in, and sign-out | `frontend/src/platform/auth/AuthContext.tsx` |
| Permission-based route protection and post-login landing | `frontend/src/app/routing/ProtectedRoute.tsx`, `frontend/src/app/routing/landing.ts` |
| Account menu (identity, own password, sign-out) | `frontend/src/platform/account/AccountMenu.tsx` |
| Module registry (routes, nav, settings, landing) | `frontend/src/app/registry.ts`, `frontend/src/platform/modules.ts`, `frontend/src/modules/index.ts` |
| Same-origin request behavior and structured API errors | `frontend/src/platform/api/client.ts` |
| Theme selection and persistence | `frontend/src/platform/theme/ThemeContext.tsx`, `frontend/src/ui/ThemeToggle.tsx` |
| Shared responsive navigation and application layout | `frontend/src/app/layouts/AdminLayout.tsx` |

## Store report

| Behavior | Current implementation |
|---|---|
| Period selection, report load/save, dirty state, and submission | `frontend/src/modules/reports/pages/StoreReportPage.tsx` |
| Quantity stepper and read-only/report status cues | `frontend/src/ui/QuantityStepper.tsx`, `frontend/src/modules/reports/components/StatusPill.tsx`, `frontend/src/ui/StateDot.tsx` |
| Collapsible feedback and inactive-product sections | `frontend/src/ui/AnimatedCollapse.tsx`, `StoreReportPage.tsx` |
| Submission confirmation | `frontend/src/ui/Dialog.tsx`, `StoreReportPage.tsx` |
| Offline draft persistence and queued edits | `frontend/src/platform/offline/offlineDrafts.ts` |
| Store report endpoint wrappers | `frontend/src/modules/reports/api.ts` |

## Administration

| Behavior | Current implementation |
|---|---|
| Month page: store register, products matrix, period, submitted-only filter, and XLSX export | `frontend/src/modules/reports/pages/ReportsMonthPage.tsx` (old `/admin/summary` links: `SummaryRedirect.tsx`) |
| Report detail and draft/submitted status update | `frontend/src/modules/reports/pages/AdminReportDetailPage.tsx` |
| «Адміністрування» hub: overview, grouped section menu, shared status message | `frontend/src/platform/admin/` |
| Product catalogue search, price changes, archive/restore, import | `frontend/src/modules/reports/settings/ProductsSection.tsx` |
| Per-organisation «По розрахунку» option | `frontend/src/modules/reports/settings/ReportSettingsSection.tsx` |
| Users, organisations and roles | `frontend/src/platform/access/` |
| Cloudflare Tunnel, backups and database health | `frontend/src/platform/system/` |
| Audit log filters and entries | `frontend/src/platform/audit/AuditLogSection.tsx` |
| Shared API calls and DTO types | `frontend/src/modules/reports/api.ts`, `frontend/src/platform/api/types.ts` |

## Server compatibility and static assets

| Behavior | Current implementation |
|---|---|
| JSON API and authentication endpoints | `internal/web/*.go` (routes registered per area, e.g. `accounts.go`; module endpoints live in `internal/<module>/http.go`), mounted by `internal/web/server.go` |
| REST API error envelopes and minimal non-API error page | `internal/web/errors.go` |
| Offline page, PWA endpoints and `/healthz` | `internal/web/server.go`, `internal/assets/static/` |
| Last-resort SPA routing after API/PWA routes | `internal/web/server.go` |
| Browser styles and theme tokens | `frontend/src/app/index.css`, `frontend/tailwind.config.js` |
| API types | `frontend/src/platform/api/schema.d.ts` (maintained by hand since the Go port) |

## Release verification

Run `go vet ./cmd/... ./internal/... && go test ./cmd/... ./internal/...` from the repository root. Run frontend lint, type checking, tests, and production build from `frontend/` with `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Run the browser check with `go build -o dist/legkyi ./cmd/server && uv run scripts/e2e_test.py` (set `CHROMIUM_PATH` to reuse an installed Chromium).
