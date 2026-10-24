# EasyMourningReport SPA Migration Plan

## 1. Scope & Strategy
Migrate EasyMourningReport from Jinja2 + Alpine.js server-rendered templates into a high-performance, accessible, client-rendered Single-Page Application (Vite + React + TypeScript + Tailwind CSS + Radix UI + TanStack Query + React Router). Zero runtime CDN dependencies; Ukrainian-only UI; responsive design targeting mobile store clerks (390px) and admin desktop/mobile (1280px / 390px).

## 2. Phase Breakdown and Touched Files

### Phase 1: Foundation
- **Backend**:
  - `app/routes/api_v1.py`: add `POST /api/v1/auth/login` and `POST /api/v1/auth/logout` reusing `core/ratelimit`, `core/security`, `db/repositories/audit`.
  - `app/main.py`: configure SPA fallback route (`/`, `/login`, `/report`, `/admin/*`) serving `app/static/app/index.html` via `asset_dir("static")` while preserving route precedence for `/api/*`, `/static/*`, `/admin/summary.xlsx`, `/admin/backup/download`, `/manifest.webmanifest`, `/sw.js`.
  - `Dockerfile`: add multi-stage build with Node.js stage building `frontend/` into `app/static/app/`.
  - `.dockerignore`: include `frontend/` but exclude `node_modules`.
- **Frontend**:
  - Initialize `frontend/` Vite React TS project.
  - Setup Tailwind CSS with tokens from section 5 (`#F4F6F5`, `#141B19`, `#2E6D60`, `#8ABFB0`, `#A34D4A`, etc.).
  - Install `@fontsource/onest` (400, 500, 600, 700) for zero-CDN typography.
  - OpenAPI schema generator `npm run gen:api` with `openapi-typescript`.
  - Typed API client with same-origin header protection and credentials.
  - UI dictionary `frontend/src/i18n/uk.ts`.
  - Auth context and Login page `/login`.
  - Theme provider with localStorage key `easyMourningReport.theme`.
- **Verification**: Pytest passes; Frontend lint/typecheck/build pass; Login flow verified.

### Phase 2: Store Report
- **Frontend**:
  - `frontend/src/pages/StoreReportPage.tsx`
  - Stepper controls (44px min touch target, `inputMode="numeric"`).
  - Repriced item rows with distinct price inputs and history tags.
  - Collapsed inactive items section.
  - Sticky bottom action bar with total, draft save, and submit with confirmation modal.
  - Unsaved changes indicator and `beforeunload` warning.
  - Read-only mode for submitted reports.
- **Verification**: E2e test at 390px for full store workflow.

### Phase 3: Offline & PWA
- **Frontend & Assets**:
  - IndexedDB/localStorage offline draft persistence.
  - Pending-sync badge & auto-sync when online.
  - `app/static/sw.js`: modern versioned app-shell service worker caching SPA assets, fonts, icons, offline page.
  - `app/static/manifest.webmanifest`: verify standalone PWA metadata.
- **Verification**: Playwright e2e with network disabled/re-enabled.

### Phase 4: Admin Read Views
- **Frontend**:
  - Admin shell with responsive sidebar (desktop >= 1024px) and bottom tabs (mobile).
  - Route code-splitting with `React.lazy`.
  - `frontend/src/pages/AdminSummaryPage.tsx`: month picker, KPI cards, table with status pills, XLSX download.
  - `frontend/src/pages/AdminReportsPage.tsx`: period list, status pills, item counts.
  - `frontend/src/pages/AdminReportDetailPage.tsx`: report inspection and lock/unlock toggle.
  - `frontend/src/pages/AdminLogsPage.tsx`: audit logs with action and user filters.
- **Verification**: Prototype matching at 1280px and responsive layout at 390px.

### Phase 5: Admin Management
- **Frontend**:
  - `frontend/src/pages/AdminSettingsPage.tsx`:
    - Products: search, single price input expanding to price editor with history chips, create product, archive/restore, Excel import.
    - Stores: store list, create, edit, archive/restore, password reset.
    - Admin password change.
    - Cloudflare tunnel status card, autostart toggle, start/stop.
    - Database backup snapshot download link.
- **Verification**: Verify parity against `docs/ui-parity.md`.

### Phase 6: Cut Over & Clean
- **Codebase cleanup**:
  - Remove Jinja2 templates `app/templates/`.
  - Remove legacy static scripts `app/static/*.js`, `app/static/app.css`.
  - Remove obsolete HTML form routes in `app/routes/`.
  - Update `tests/` for full coverage of SPA fallback, JSON auth, and API routes.
  - Accessibility audit (WCAG AA) and bundle size check (<120 KB gzip for store entry).
  - Update `README.md` and `DESIGN.md`.
- **Verification**: All quality gates green.
