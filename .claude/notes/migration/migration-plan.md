> **Status: complete.** The port was implemented through slice 7 and the Python backend was removed in release `Soup.V5`. This folder is kept as the historical record of the decisions and risks; see [ADR 0004](../../../docs/adr/0004-port-backend-to-go.md) for the outcome. File paths below that start with `backend/` refer to the removed Python code (last present at commit `92564ef`).

# Go migration plan (proposal; awaiting approval)

## Goal and non-goals

Replace the Python backend with a Go binary that:
- serves the unchanged React SPA;
- opens the existing `reports.db` in place;
- keeps every endpoint, status code and error shape listed in `api-contracts.md`.

Non-goals: new features, a new database, API redesign, frontend changes beyond build output paths.

## Proposed architecture

```text
cmd/server/main.go     config + paths + wiring + signal handling (one file plus small helpers)
internal/store         open SQLite (DSN pragmas, journal-mode detection), schema check/create-missing,
                       migration-id check, backup (VACUUM INTO + verify + retention + loop), integrity, checkpoint
internal/web           router (net/http ServeMux), JSON + the 3 error shapes, CSRF guard, session cookie,
                       principal/permission middleware, login rate limiter, client-IP trust, static/SPA/PWA (embed.FS)
internal/platform      organisations, users, roles, permission catalogue, escalation rules, audit, overview,
                       system handlers (backups, health, tunnel endpoints)
internal/reports       pricing (pure), money parsing, report lines/summary, XLSX import/export, handlers
internal/transport     the status stub (one file), kept so module boundaries match the frontend
internal/tunnel        cloudflared supervisor; tunnel_linux.go / tunnel_windows.go for process control
```

Why each piece exists:

- **One binary, `embed.FS`.** This is the single-exe requirement for Windows. Docker copies the same binary.
- **`store` separate from handlers.**
  - It is the only code that can destroy data, so it is tested hardest and in isolation.
  - The startup sequence matches `lifecycle.py`: integrity check, then schema, roles and first admin, then backup, then the loop.
- **`web` separate from domain packages.** Session, CSRF, error shapes and permission checks are shared by every handler and must behave identically everywhere.
- **`platform` and `reports` as domain packages.** They mirror today's ownership and `CLAUDE.md`'s module boundaries.
  - Business rules, such as escalation guards and price history, are plain functions over `*sql.Tx`, testable without HTTP.
  - A module is a plain Go struct: permissions, audit actions, organisation-usage func, overview func, routes. A static slice replaces `ModuleRegistry`; there is no plugin mechanism.
- **Libraries.** Stdlib `net/http` and `database/sql` with hand-written SQL: about 40 queries, no ORM, no codegen. Driver `modernc.org/sqlite` (pure Go, so cross-compiling for Windows needs no CGO). `github.com/xuri/excelize/v2` for XLSX. Go 1.24 `crypto/pbkdf2`.

Reconciled with the independent review (Opus advisor):

- **Accepted:**
  - single cut-over, no production hybrid;
  - drop itsdangerous cookie compatibility (one forced re-login), subject to Q4;
  - schema-equivalence test (R1);
  - data-safety code ported first;
  - strings for DATETIME columns;
  - `BEGIN IMMEDIATE` or a single writer;
  - `Pdeathsig` and Job Objects for cloudflared;
  - don't promise Pydantic's lax coercion;
  - keep the naive audit `ts` unless Q5 says otherwise.
- **Changed from the review:** the reviewer proposed folding accounts, audit and overview into the HTTP package. I keep `platform` separate from `web`. The escalation and last-admin rules are the most security-sensitive logic and are easier to test as functions. Otherwise I took the smaller package count.
- **Dev only:** a reverse proxy from Go to Python, for clicking through partly ported builds locally. It never ships.

## Sequence (vertical slices; each ends green)

| Slice | Content | Acceptance criteria |
|---|---|---|
| 0. Characterization | Python-side HTTP fixture suite (see `api-contracts.md`, last section) over a seeded DB. Golden XLSX import/export fixtures. Schema snapshots of fresh and legacy-migrated DBs. Python-made password hashes and money-parse cases. | Suite runs against Python and passes. Fixtures are committed. No Python behaviour changed. |
| 1. Skeleton and store | Config, paths (identical resolution and fallback), DSN pragmas, journal-mode detection, migration-id check, create-missing-tables, built-in roles and first admin, backup, verify, retention, loop, shutdown checkpoint and backup, `/healthz`, static/PWA/SPA fallback. | Opens copies of fresh and migrated Python DBs read/write without schema change. Schema-equivalence test passes. Backup restore round trip. SPA deep links work. `/api/*` 404 is JSON. |
| 2. Session and auth | Login, logout, session, own password, CSRF, rate limit, client-IP trust, audit write, principal and permission middleware. | Python hashes verify. 401/403/429 fixtures match. Audit rows are byte-compatible with the Python format. |
| 3. Read-only endpoints | Organisations, users, roles, permissions, logs and log actions, overview, products list, store report GET, admin reports list and detail, summary, settings list, backups, health, transport status. | All GET fixtures match after normalisation. |
| 4. Write endpoints | Account and role mutations (escalation guards, last admin), product CRUD and price history, store report save and submit, lock and unlock, settings toggle. | All mutation fixtures match. Concurrency test (ADR 0003-style) shows 0 errors. |
| 5. XLSX | Import and summary export. | Fixture corpus parses identically. Exported workbooks match by values and formats. |
| 6. Tunnel and system | cloudflared supervisor, start/stop/autostart, backup download. | Mocked-binary tests ported. Manual check with a real quick tunnel. |
| 7. Packaging | Dockerfile: Node build, then Go build, then a slim runtime with cloudflared and curl, same mounts and env. Windows `.exe` build with data next to the exe. The e2e Playwright script runs against Go. | `docker compose up -d --build --remove-orphans` works on an existing `app_storage/`. The exe runs on a real Windows machine (Q2). `scripts/e2e_test.py` passes. |
| 8. Cut-over | Stop Python, take a tagged backup, start Go on the same data. Rollback is the previous image plus that backup. Remove Python only after an agreed soak period. | Users sign in once more; reports, prices and logins are intact. |

## Must test before porting (current gaps)

- HTTP-level golden fixtures for every endpoint and role. Today's tests assert selected fields, not full responses.
- XLSX import fixtures with real-world quirks (formulas, floats, dates, active sheet ≠ first) and a full-layout golden check of the export.
- Org-admin escalation edge cases:
  - kept roles;
  - moving roles between organisations;
  - role-name collisions;
  - deleting or resetting a more-privileged user.
- Migrated-DB behaviour: run the full API fixture suite against a DB produced by the legacy migrations, not only a fresh one.
- Month boundary and `current_period` behaviour for price changes and allowed report periods.
- Concurrent saves (load test) and shutdown during a write.
- Windows runtime: paths fallback, WAL, console close, cloudflared lifecycle. Nothing tests this today.

## Questions that need your decision

1. **Why migrate?** No document states the driver; ADR 0003 shows Python performance is ample. Is it the single Windows exe, memory or maintenance? This sets the success criteria.
2. **Windows today.** How is the Windows build produced and run now (PyInstaller exe, `uv run`, a service)? Where does its data live?
3. **Legacy databases.** Has every production database already been started with the current Python release (all 3 migration ids present)? If yes, Go skips porting the legacy upgrade code.
4. **Sessions at cut-over.** Is one forced re-login for everyone acceptable? Recommended, and it avoids reimplementing itsdangerous.
5. **Audit-log times.** They currently display 2–3 h early in the browser (naive UTC). Keep this bug-for-bug, or fix it during the migration with an explicit `Z`?
6. **Generated TS types.** Is it acceptable to freeze `schema.d.ts` during the migration and maintain an `openapi.json` by hand afterwards?
7. **Real XLSX samples.** Can you provide real product-import files and an example of how the exported summary is used downstream?
