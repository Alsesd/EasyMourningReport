# UI Behavior and Implementation Map

This document records the current browser behavior and points to the code that owns it. Older server-rendered page templates and static page scripts have been removed; references to them are intentionally not used as current file paths. This is an implementation map, not a claim that the full browser E2E suite was run during the latest restructure.

## Application shell and authentication

| Behavior | Current implementation |
|---|---|
| React router and route-level lazy loading | `frontend/src/app/App.tsx`, `frontend/src/modules/reports/module.tsx` |
| Login form, validation feedback, and focus behavior | `frontend/src/app/pages/LoginPage.tsx` |
| Session loading, sign-in, and sign-out | `frontend/src/platform/auth/AuthContext.tsx` |
| Role-based route protection | `frontend/src/platform/auth/ProtectedRoute.tsx` |
| Same-origin request behavior and structured API errors | `frontend/src/platform/api/client.ts` |
| Theme selection and persistence | `frontend/src/app/providers/ThemeContext.tsx`, `frontend/src/ui/ThemeToggle.tsx` |
| Shared responsive navigation and application layout | `frontend/src/app/layouts/AdminLayout.tsx` |

## Store report

| Behavior | Current implementation |
|---|---|
| Period selection, report load/save, dirty state, and submission | `frontend/src/modules/reports/pages/StoreReportPage.tsx` |
| Quantity stepper and read-only/report status cues | `frontend/src/ui/QuantityStepper.tsx`, `frontend/src/ui/StatusPill.tsx` |
| Collapsible feedback and inactive-product sections | `frontend/src/ui/AnimatedCollapse.tsx`, `StoreReportPage.tsx` |
| Submission confirmation | `frontend/src/ui/Dialog.tsx`, `StoreReportPage.tsx` |
| Offline draft persistence and queued edits | `frontend/src/platform/offline/offlineDrafts.ts` |
| Store report endpoint wrappers | `frontend/src/modules/reports/api.ts` |

## Administration

| Behavior | Current implementation |
|---|---|
| Summary cards, reporting period, submitted-only filter, and XLSX export | `frontend/src/modules/reports/pages/AdminSummaryPage.tsx` |
| Report listing and period filter | `frontend/src/modules/reports/pages/AdminReportsPage.tsx` |
| Report detail and draft/submitted status update | `frontend/src/modules/reports/pages/AdminReportDetailPage.tsx` |
| Product catalogue search, price changes, archive/restore, import, store accounts, and password settings | `frontend/src/modules/reports/pages/AdminSettingsPage.tsx` |
| Tunnel status/start/stop/autostart contract | `frontend/src/modules/transport/api.ts`, consumed by `AdminSettingsPage.tsx` |
| Audit log filters and entries | `frontend/src/modules/reports/pages/AdminLogsPage.tsx` |
| Shared API calls and DTO types | `frontend/src/modules/reports/api.ts`, `frontend/src/platform/api/types.ts` |

## Server compatibility and static assets

| Behavior | Current implementation |
|---|---|
| JSON API and authentication endpoints | `backend/app/routes/api_v1.py`, `backend/app/routes/auth.py`, `backend/app/routes/admin/` |
| REST API error envelopes and legacy HTML fallback errors | `backend/app/core/http_errors.py`, `backend/app/core/web.py` |
| Offline page and PWA endpoints | `backend/app/routes/pwa.py`, `backend/app/templates/offline.html` |
| Last-resort SPA routing after API/PWA routes | `backend/app/routes/fallback.py` |
| Browser styles and theme tokens | `frontend/src/app/index.css`, `frontend/tailwind.config.js` |
| Generated OpenAPI types | `frontend/src/platform/api/schema.d.ts`, regenerated with `npm run gen:api` from `frontend/` |

## Release verification

Run the backend suite from the repository root with `uv run --locked pytest`. Run frontend lint, type checking, tests, and production build from `frontend/` with `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Run `python scripts/e2e_test.py` only in an environment with Playwright and its Chromium browser installed.
