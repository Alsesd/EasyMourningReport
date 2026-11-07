# Feature inventory

Each flow is traced as **Frontend → API → logic → DB → response**. Endpoint details are in `api-contracts.md` and tables in `sqlite.md`. "Tests" names the existing automated coverage; ⚠ marks gaps.

## Platform

### Sign-in, session, sign-out
- **Frontend.** `app/pages/LoginPage.tsx` and `platform/auth/AuthContext.tsx`.
  - `GET /api/v1/session` is the "who am I" query. A 401 becomes `null` and the app shows the login page.
  - Logout errors are swallowed.
- **Logic.** `platform/accounts/auth.py` → `authenticate_credentials`:
  1. The login is normalised (trimmed, lower-cased).
  2. The rate limit (`core/ratelimit.py`) is checked before any DB lookup.
  3. The password is checked with `check_pw`, which uses PBKDF2-SHA256 with 200k iterations (`core/security.py`).
  4. `can_sign_in` checks that the user is active and that the organisation exists and is not archived.
  5. The attempt is audited (success or failure).
  6. The session is cleared and `session["uid"]` is set.
- **DB.** `users`, `user_roles`, `roles`, `role_permissions`, `organisations`, `audit_log`.
- **Response.** `SessionDTO`: user, org, role names, effective permissions (sorted), installed module names, current period.
- **Implicit behaviour.**
  - Effective permissions come only from roles whose scope matches the user. Platform users have `organisation_id IS NULL`.
  - The built-in roles `platform_admin` and `org_admin` hold every code of their scope dynamically.
  - Grants for unknown codes are ignored.
  - Disabled users and users of archived organisations get 401 on every request, which logs them out.
- **Tests.** `test_auth_edges.py`, `test_spa_and_auth_api.py`, `test_ratelimit.py`, `test_security*.py`.

### Organisations, users, roles, permissions
- **Frontend.** `platform/access/{OrganisationsSection,UsersSection,RolesSection}.tsx` and `platform/access/api.ts`.
- **Logic.** `platform/accounts/routes.py` and `service.py`.
- **Escalation guards.**
  - Org managers (`org.users.manage` without `platform.users.manage`) are pinned to their own organisation and get 404 for other users.
  - They can only assign roles whose permissions are a subset of their own, and they keep roles they cannot grant.
  - They can reset or delete only users whose permissions are a subset of their own.
- **Invariants.**
  - At least one active platform admin must remain, checked after a flush.
  - Nobody can disable or delete themselves.
  - Built-in roles cannot be deleted.
  - A role's scope is immutable.
  - Role names are unique per organisation (case-insensitive).
  - Organisation names are unique, case-insensitive and whitespace-normalised. The DB index is case-sensitive; the app check is not.
- **Delete semantics.**
  - An organisation with module data (`reports` count) is archived.
  - Otherwise a `before-delete` backup is taken, then the organisation is deleted along with its users, user roles and organisation-specific roles.
- **Tests.** `test_accounts_api.py` (8 scenarios, including escalation and last-admin).
  - ⚠ Role-name collision rules, roles moving between organisations, and the `_check_kept_roles` behaviour are covered only indirectly.

### Audit log
- **Writes.** `platform/audit/service.audit()` writes `(login, role label, action, detail, ip)` in the caller's transaction. Action names are Ukrainian strings: the platform list plus `reports` AUDIT_ACTIONS.
- **Reads.** `GET /admin/logs` filters with `login LIKE %x%` (lower-cased input) and an exact `action` match, ordered by id descending, limit 1..500.
- **Frontend.** `platform/audit/AuditLogSection.tsx` shows `ts` through `formatDateTime`.
- **Implicit (probed).** `ts` is stored as naive UTC text and serialised without `Z`. The browser therefore shows it as local time, which is off by the UTC offset (2–3 hours in Ukraine).
- **Tests.** Filters in `test_api_v1.py`; `test_repositories.py::test_audit_logging`.

### Administration overview
- `GET /admin/overview` (`platform/overview.py` plus `modules/reports/overview.py`). Each section appears only if the caller holds the required permission.
- The org-admin variant reports counts for their own organisation.
- **Tests.** `test_overview_api.py`.

### System: backups, health, tunnel
- **Backups** (`db/backup.py`).
  - The `sqlite3` online backup API writes `reports-YYYYmmdd-HHMMSS[-tag].db`, using **local** time.
  - The copy is switched to `journal_mode=DELETE` and verified with `quick_check`. A failed copy is deleted and an error is raised.
  - Retention keeps the newest `BACKUP_KEEP` files by name.
  - Untagged runs are skipped when the db/wal mtime is not newer than the newest backup.
  - Tags in use: `before-migrate`, `before-delete` (organisation or product hard delete), `snapshot` (download).
- **Download.** `GET /admin/backup/download` takes a fresh `snapshot` and streams that copy, never the live file. An audit failure does not fail the download.
- **Health.** Integrity verdict, journal mode, db+wal size, backup count and newest mtime (UTC with `Z`), backup interval.
- **Tunnel** (`platform/system/tunnel.py`).
  - Runs a `cloudflared` child process with `--metrics 127.0.0.1:20241`.
  - With a token (`TUNNEL_TOKEN` env, or `data/tunnel/token` saved with mode 0600) it runs a named tunnel. Without one it runs a quick tunnel to `127.0.0.1:$PORT`.
  - Status comes from metrics `/ready` (`readyConnections`) and `/quicktunnel` (`hostname`).
  - Autostart uses the `data/.tunnel-enabled` marker, migrating the legacy `.tailscale-funnel-enabled` marker.
  - Startup precedence: `TUNNEL_ENABLED` falsy beats `TUNNEL_ENABLED` truthy or `TUNNEL_TOKEN`, which beat the marker.
- **Restore.** There is **no in-app restore**. Restore is manual: stop the app, replace `reports.db`, start it again (ADR 0003).
- **Tests.** `test_backup.py`, `test_backup_route.py`, `test_system_api.py`, `test_tunnel.py` (cloudflared mocked).
  - ⚠ No test runs a real cloudflared.
  - ⚠ No test covers the shutdown backup on a real signal.

### PWA, static files, SPA
- Routes: `/manifest.webmanifest`, `/sw.js` (no-cache), `/offline`, `/healthz` (`SELECT 1`), the `/static/*` mount, and the catch-all serving `static/app/index.html`.
- `api/*` and `static/*` paths are never served by the fallback: they return a 404 HTML page, or JSON under `/api/v1`.
- The SW precaches the shell. Navigation is network-first with an `/offline` fallback.
- **Tests.** `test_api_router_structure.py`, `test_static_assets.py`, `test_spa_and_auth_api.py`.

## Reports module (`backend/app/modules/reports`, `frontend/src/modules/reports`)

### Product catalogue and price history
- **Frontend.** `settings/ProductsSection.tsx` (the largest page, 628 lines).
- **Price model** (`pricing.py`, pure functions).
  - History rows are `(period, cents)`. The base row is `0000-00`.
  - A change in month M is keyed `M`, then `M_1`, `M_2`, and so on. Suffixes sort numerically; legacy `#` suffixes are recognised.
  - A change equal to the current price is a no-op.
  - A change back to an earlier amount is still recorded.
  - Changes always apply to `current_period()`, the server's local month.
  - `products.price_cents` caches the latest price.
- **Create.** No duplicate-name check: the API accepts duplicate names **(probed)**. The XLSX import does skip duplicates.
- **Update.** Name, active flag and price, in one endpoint or with a separate price endpoint. The price endpoint accepts `{"price": <string or number>}` from any JSON object.
- **Delete.** A product used in any report item is archived (`archived=1, active=0`). Otherwise a `before-delete` backup is taken and the product and its price rows are hard-deleted.
- **Import** (`excel.py`). See `api-contracts.md`, XLSX section.
- **Tests.** `test_pricing.py` (pure functions, good coverage), `test_api_v1.py`, `test_excel_import.py`, `test_repositories.py`.

### Store monthly report
- **Frontend.** `pages/StoreReportPage.tsx`, the standalone `/report` route.
  - Drafts autosave to `localStorage` (`platform/offline/offlineDrafts.ts`, key `easyMourningReport.draft.<orgId>.<period>`).
  - A 409 response tells the user to reload.
- **Read.** `GET /store/reports/{period}`.
  - Allowed only for the current period or periods that already have a report for this organisation; otherwise 404.
  - `build_lines` produces:
    - one row per active product, ordered by name with BINARY collation, with input lines per offered price (`offered_prices` plus any extra saved prices, labelled `old`/`new`/`saved`);
    - inactive or archived products that have saved quantities, as read-only text lines;
    - totals.
  - `quantity_calc` («По розрахунку») never counts toward money totals. It is shown only if enabled for the organisation.
- **Save.** `PUT /store/reports/{period}`.
  - A period outside the allowed set returns 403. A submitted report returns 409.
  - A draft row is created on first save.
  - Each (product, price) pair must be offered or already saved with a non-zero quantity; otherwise 409 "prices changed". A duplicate pair returns 422.
  - Omitted `quantity_calc` keeps the existing value.
  - Rows for editable products are deleted and re-inserted. Rows for inactive products are untouched.
  - The status is set to `draft` or `submitted`, and the save is audited.
- **Tests.** `test_api_v1.py` (round trip, locking, validation, preservation), `test_report_lines.py`, `StoreReportPage.test.tsx`.

### Review, lock and summary ("combined report")
- **Frontend.** `pages/ReportsMonthPage.tsx` (store register plus products matrix plus Excel link) and `AdminReportDetailPage.tsx`.
- **List.** `GET /admin/reports?period`: every non-archived organisation, plus archived ones that have a report. Status is `none`, `draft` or `submitted`.
- **Lock and unlock.** `PATCH /admin/reports/{id} {status}` is audited.
- **Summary** (`build_summary`).
  - Matrix of rows × stores. Each row is a product × price, with quantity, calc quantity and sum cells.
  - Archived stores and switched-off products appear only when they have data that month.
  - `note`/`label` text describes old and new prices.
  - `submitted_only` filters to submitted reports.
- **XLSX export** (`generate_summary_excel`).
  - One sheet named «Звіт». Columns: Назва, Ціна, Звітована кількість, [Кількість по розрахунку], Сума.
  - Per-store columns are **not** exported. The calc column appears only if any store has calc enabled.
  - Money cells are written as floats `/100` with format `#,##0.00`.
  - Header and total rows are bold. Panes are frozen at A2, and the auto-filter excludes the totals row.
  - The file is named `zvit-YYYY-MM.xlsx`.
- **Tests.** `test_api_v1.py`, `test_services.py::test_generate_summary_excel`, `test_repositories.py`.
  - ⚠ No test reads back the full XLSX layout (widths, formats, filter) as a golden file.

### Report settings
- `GET/PUT /reports/settings[/{org}]` toggles `report_settings.calculation_enabled` and is audited.
- **Frontend.** `settings/ReportSettingsSection.tsx`.
- **Tests.** `test_api_v1.py::test_store_calculation_toggle_and_combined_summary`.

## Transport module
- `GET /transport/status` returns `{ready:false, message}` to anyone holding a `transport.orders.*` permission.
- It has 3 permissions, no tables, and a placeholder page.
- **Port effort:** trivial.

## Dependencies between features

```text
session/auth ─┬─> every endpoint (principal + permissions)
              └─> audit write (login, role label, ip)
accounts ──> organisation_usage(reports) decides archive vs delete
reports ───> organisations (store_id), report_settings, audit, backup (before-delete)
overview ──> accounts, audit, tunnel, health, reports.overview
system ────> backup, tunnel, audit
lifecycle ─> integrity check → migrations → built-in roles/first admin → backup → loop → tunnel
```
