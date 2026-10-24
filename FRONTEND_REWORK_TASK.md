# Task: rework the EasyMourningReport UI into a client-rendered SPA

Put this file in the repo root and the two reference files in `design-reference/`. Read all of it before writing code. Start by producing a plan (phases below, with the files you expect to touch), then implement phase by phase.

## 0. How to work

- One phase = one branch-sized chunk = one or more commits. Commit message prefix: `fe:` or `be:`.
- After each phase: run the quality gates (section 9) and post a short report with screenshots (390 px and 1280 px wide) of every screen you touched.
- Do not ask questions you can answer by reading the code. Ask only when two reasonable readings lead to different behaviour, and propose a default.
- Read before you change: `DESIGN.md`, `API.md`, `app/routes/api_v1.py`, `app/routes/auth.py`, `app/dto.py`, the current templates and `app/static/*.js` (they are the behaviour spec for parity, section 7).

## 1. Goal

Replace the Jinja + Alpine.js UI with a proper client-rendered single-page app that is clean, fast on cheap phones, accessible and beautiful. Same features, same data, same API contract, a new frontend. The backend keeps SQLite and FastAPI.

Two audiences, designed separately:
- **Store clerk** (phone, one hand, monthly report entry): `/report`.
- **Admin** (phone and desktop): `/admin/*`.

## 2. Skills to use

Install them in the workspace (see "Setup" at the end), then use them deliberately:

| Skill | Use it for |
|---|---|
| `frontend-design` (anthropics) | Visual quality. Read it before designing any screen. Avoid generic, template-looking output; follow the design spec in section 5. |
| `webapp-testing` (anthropics) | Playwright driving the real running app: screenshots, e2e flows, console errors. Use it for every phase report. |
| `web-design-guidelines` (vercel-labs) | Audit each finished screen for accessibility, focus states, forms, touch, dark mode. Fix findings before reporting. |
| `vercel-react-best-practices` (vercel-labs) | Client-side rules only (re-renders, data fetching, bundle size). Ignore its Next.js and server-component rules; this is a Vite SPA. |
| `vercel-composition-patterns` (vercel-labs) | Shape reusable components (no boolean-prop pile-ups). |

## 3. Out of scope (do not touch)

- `compose.yaml` and the tunnel token in it. It is hardcoded on purpose so the app launches on other machines with no setup. Do not "fix" it.
- Tunnel/Tailscale code cleanup, `CLEANUP_BRIEF.md` items, Postgres or any DB change, DB schema.
- Existing `/api/v1` request/response shapes. You may ADD endpoints. Changing or removing one needs a note in the report with the reason.
- Only exception in Docker/CI: adding the frontend build (section 6).

## 4. Current state (verified)

- Backend: FastAPI app in `app/`, Jinja templates in `app/templates/`, vanilla/Alpine scripts in `app/static/` (`app.js`, `admin.js`, `admin-*-app.js`, `report-app.js`, `api-client.js`, `app.css`). Alpine is loaded from jsdelivr when `app/static/alpine.min.js` is absent (it is gitignored), so a plain clone depends on a CDN. The new frontend must have zero runtime CDN dependencies.
- JSON API already exists under `/api/v1`: `GET /session`; admin products (list, create, update, price, delete, restore, xlsx import); admin stores (list, create, update, delete, restore, password); `PUT /admin/password`; `GET/PUT /store/reports/{period}`; admin reports (list, detail, `PATCH` status); `GET /admin/summary`; `GET /admin/logs`, `GET /admin/log-actions`; `/admin/tunnel` (GET/POST/DELETE, `PUT .../autostart`); legacy duplicate `/admin/tailscale*`.
- Server-rendered HTML routes (`/login`, `/report`, `/admin`, `/admin/reports`, `/admin/summary`, `/admin/logs` and their POST forms) duplicate the API. Login and logout exist only as form POSTs (`app/routes/auth.py`), cookie session via Starlette `SessionMiddleware`.
- `same_origin_post_guard` rejects unsafe requests without a matching `Origin`/`Referer`. Same-origin `fetch` satisfies it. Keep it.
- Real server routes that stay as plain links, not API calls: the XLSX summary download (`/admin/summary.xlsx`) and the DB backup download. Confirm their exact paths from the router prefixes.
- PWA bits exist: `manifest.webmanifest`, `sw.js`, `/offline`, icons.
- Packaging: static files are located through `app/core/paths.py:asset_dir("static")`, which also supports the frozen Windows exe. Keep the SPA output under `app/static/` so this keeps working.

## 5. Design spec

The approved prototype is in `design-reference/` (`store-report-mobile.dc.html`, `admin-summary-desktop.dc.html`). They are static markup with inline styles, so read them as a visual spec, not code to copy. Screens other than these two follow the same language.

**Tokens** (extend `DESIGN.md`; this becomes the Tailwind theme):

| Role | Light | Dark |
|---|---|---|
| Page | `#F4F6F5` | `#141B19` |
| Surface | `#FFFFFF` | `#1D2724` |
| Text | `#1C2A26` | `#E7EFEB` |
| Muted text | `#5E6E69` | `#9BAEA6` |
| Border | `#DCE5E1` | `#34433D` |
| Primary | `#2E6D60` (white text) | `#8ABFB0` (dark text) |
| Destructive | `#A34D4A` | `#E49A92` |
| Pill: sent | bg `#DCEFE9` text `#1F4F44` | derive, check AA |
| Pill: draft | bg `#FFF1D6` text `#6B4A00` | derive, check AA |
| Pill: not started | bg `#E9EEEC` text `#44524E` | derive, check AA |

- Font: **Onest** (400/500/600/700, Cyrillic + Latin), self-hosted via `@fontsource/onest`. No Google Fonts at runtime.
- Radii: cards 16 px, controls 12 px, pills fully round. Touch targets at least 44 px. Visible focus rings. Respect `prefers-reduced-motion`. WCAG AA contrast, including muted text.
- Theme: light / dark / system. Keep the localStorage key `easyMourningReport.theme` and the "display preferences" menu behaviour.
- UI language: Ukrainian only. Keep all strings in one `frontend/src/i18n/uk.ts`, no i18n library. Format money, numbers and dates with `Intl` (`uk-UA`). Check how the current UI formats `price_cents` and keep the same output.

**Store screen (mobile first, centered `max-w-md` on larger screens):**
- Top bar with the store name and a menu; month switcher (previous/next, next disabled after the current period) with the status pill.
- One card per product: name, price, `−` / numeric input / `+` stepper (44 px), line sum. Products repriced during the month show one row per price with the date it applies from. Inactive items in a collapsed section, read-only.
- Sticky bottom bar: month total, "Зберегти чернетку" (secondary), "Надіслати звіт" (primary) with a confirmation dialog. Submitted reports are read-only.
- Numeric keypad (`inputMode="numeric"`), no layout jump when the keyboard opens, unsaved-changes indicator.
- Offline: edits are kept locally (IndexedDB or localStorage) and a pending-sync badge is shown; they sync when back online. The server response is the source of truth after save.

**Admin (responsive):**
- Desktop: left sidebar (Налаштування, Звіти, Зведений, Журнал, sign out). Phone: bottom tab bar.
- Зведений: month picker, XLSX download link, KPI cards, store table with status pills (tables scroll inside their own container on narrow screens).
- Звіти: list by period, detail view, status change.
- Налаштування: products (search, price editing exactly as in `DESIGN.md` "Price editing", archive/restore, XLSX import), stores (create, edit, archive/restore, reset password), admin password, tunnel status card (same behaviour as today, restyled only), backup download.
- Журнал: audit log with action filter.

## 6. Target architecture

- `frontend/`: Vite + React + TypeScript (strict) + Tailwind + shadcn/ui (Radix) + TanStack Query + React Router. ESLint + Prettier.
- Build output to `app/static/app/` (`base: "/static/app/"`), gitignored. FastAPI serves its `index.html` for every non-API, non-static GET that is not a real server route (`/`, `/login`, `/report`, `/admin/*`). Real routes (`/api/*`, `/static/*`, XLSX and backup downloads, `/manifest.webmanifest`, `/sw.js`) must keep winning; test the ordering.
- Route-level code splitting: the store route must not load admin code.
- Types: generate `frontend/src/api/schema.d.ts` from FastAPI's OpenAPI (`npm run gen:api`, which dumps `app.openapi()` with Python and runs `openapi-typescript`). Use a small typed fetch wrapper; no hand-written duplicate DTOs.
- Docker: add a Node build stage to `Dockerfile` that builds the frontend and copies the output into the runtime image, so `docker compose up --build` works on a clean clone with no Node installed. `.dockerignore` must not exclude `frontend/` from the build context but must exclude `node_modules`.
- CI: add a frontend job (`npm ci`, lint, typecheck, test, build). Keep the existing test job working. The Windows exe build workflow must build the frontend first and bundle `app/static/app/`; add that step if such a workflow exists in this checkout, otherwise list it in the report.
- Service worker: replace `sw.js` with an app-shell cache (versioned, no stale-forever bug) and keep the `/offline` fallback behaviour.

## 7. Backend changes

1. `POST /api/v1/auth/login` and `POST /api/v1/auth/logout` (JSON). Reuse the logic, rate limiting and audit entries from `routes/auth.py` rather than duplicating it. Wrong credentials return 401 JSON with a Ukrainian message like today.
2. SPA fallback route and index serving through `asset_dir("static")`.
3. After parity is proven (phase 6): delete the Jinja templates, the HTML form routes in `app/routes/` and `app/routes/admin/`, the old `app/static/*.js`/`app.css`, and their tests. Keep `/api/v1`, the XLSX and backup routes, PWA routes and `/login` GET (served by the SPA).
4. Update pytest: remove tests of deleted HTML routes, add tests for the new auth endpoints, the SPA fallback, and route precedence. The suite must stay green at every phase.

**Parity checklist.** Before deleting anything, write `docs/ui-parity.md`: every action and rule in the current templates/scripts (validation, formatting, read-only states, error messages, confirmations, flash messages, price-history rules from `DESIGN.md`) mapped to the new component that implements it. Anything not mapped blocks phase 6.

## 8. Phases

1. **Foundation.** `frontend/` scaffold, tokens, Onest, shadcn base components, API client + generated types, SPA fallback route, JSON login/logout, login screen, session handling, Docker build stage. DoD: login works against the real backend; `docker compose up --build` serves it.
2. **Store report.** Full store screen per section 5, with save draft, submit, read-only, repriced rows, inactive rows. DoD: e2e flow passes at 390 px.
3. **Offline + PWA.** Local draft persistence, sync badge, new service worker, manifest check. DoD: e2e with the network switched off and on.
4. **Admin read views.** Shell/navigation, Зведений, Звіти (list, detail, status change), Журнал. DoD: matches the admin prototype at 1280 px and works at 390 px.
5. **Admin management.** Products, stores, passwords, import, tunnel card, backup download. DoD: every item in `docs/ui-parity.md` for these areas is checked.
6. **Cut over and clean.** Dark theme pass, accessibility pass, delete legacy UI code, final docs (`README` frontend section, `DESIGN.md` updated to the new tokens and component rules). DoD: section 9 all green.

## 9. Quality gates (every phase)

- `pdm run pytest` green. Frontend: `npm run lint && npm run typecheck && npm test && npm run build`.
- Playwright e2e (use `webapp-testing`) for: store clerk logs in, edits quantities, saves a draft, submits; admin logs in, opens the summary, changes a report status, adds a product, changes a price, downloads XLSX. Run against the real app, and no console errors.
- `web-design-guidelines` audit on each new screen, findings fixed.
- Budgets: store route initial JS under 120 KB gzip, Lighthouse accessibility 95 or higher on `/report` and `/admin`.
- No new runtime network dependency (no CDN fonts, scripts or icons). Verify by blocking all external requests in Playwright.
- No secrets in the repo; do not print the tunnel token.

## 10. Final report

List what shipped per phase, API additions (and any API change with the reason), deleted files, bundle sizes, open issues, and what could not be verified. Keep out anything you did not run.

## Setup (once, before starting)

Antigravity reads workspace skills from `.agents/skills/<name>/SKILL.md` (older `.agent/skills/` still works) and global ones from `~/.gemini/config/skills/`. Install only the five above. Large bundles slow agent start-up, and third-party skill repos have contained malicious skills, so read each `SKILL.md` before enabling it.

```bash
npx skills add anthropics/skills --skill frontend-design
npx skills add anthropics/skills --skill webapp-testing
npx skills add vercel-labs/agent-skills --skill web-design-guidelines
npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices
npx skills add vercel-labs/agent-skills --skill vercel-composition-patterns
ls .agents/skills .agent/skills 2>/dev/null   # confirm they landed in the workspace
```

If the CLI put them somewhere Antigravity does not read, copy them manually:

```bash
mkdir -p .agents/skills && cd /tmp
git clone --depth 1 https://github.com/anthropics/skills anth
git clone --depth 1 https://github.com/vercel-labs/agent-skills vl
cp -r anth/skills/frontend-design anth/skills/webapp-testing "$OLDPWD/.agents/skills/"
cp -r vl/skills/web-design-guidelines vl/skills/react-best-practices vl/skills/composition-patterns "$OLDPWD/.agents/skills/"
```
