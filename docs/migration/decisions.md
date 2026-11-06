# Migration decisions

**User directive:** "I don't need a byte-for-byte port, I need this app written in Go." The contract
fixtures are a regression aid, not a spec: where Go deliberately differs (e.g. audit `ts` with `Z`), update the
fixture copy and note it here. The SPA must keep working unchanged.

**Commits:** one commit per slice, explicit paths only; `.claude/hooks/post-edit-check.sh` stays out (user-local).

## Write rules (Go)
- `Store.W` has exactly one connection. Code inside a W transaction must never call `s.W`/`Begin` again (deadlock). Write helpers take a `*sql.Tx` only.
- A handler that writes does its reads inside its W transaction, not on R.
- Pass the request context to `BeginTx`.

# Working defaults for the open questions

The user asked for the full Go rewrite. The open questions in `migration-plan.md` were not
answered, so each takes its documented default. Revisit when marked.

| Q | Default taken | Revisit at |
|---|---|---|
| Q1 why migrate | Not stated; success = parity with the contract fixtures | – |
| Q2 Windows | Data next to the exe, `%LOCALAPPDATA%\LegkyiZvit` fallback; untested on Windows | Slice 7 |
| Q3 legacy DBs | Go refuses to start if any of the 3 migration ids is missing (tells the user to run the last Python release once) | Slice 8 |
| Q4 sessions | **User: yes.** One forced re-login; new signed cookie, itsdangerous not reimplemented | – |
| Q5 audit `ts` | **User: fix it.** API returns audit `ts` with a trailing `Z` (stored text stays naive UTC) | done at Slice 3 |
| Q6 TS types | `schema.d.ts` frozen | Slice 8 |
| Q7 XLSX samples | Synthetic fixtures only until real samples exist | Slice 5 |

## Slice 1 facts worth remembering

- **Layout:** `go.mod` at the repo root (module `legkyi`); `cmd/server`, `internal/{config,store,platform,web,assets}`.
- **Embedding:** `internal/assets/dist/` is filled by `scripts/go_assets.sh` (copy of `backend/app/static` including the Vite build in `static/app`). Only `.gitkeep` is committed. Run `npm run build` first.
- **Go toolchain here:** not on PATH; use `nix shell nixpkgs#go --command go ...` (Go 1.26).
- **R12 verified:** modernc turns columns declared `DATETIME`/`TIMESTAMP` into `time.Time`; scanning into a string gives RFC3339 (`…T…Z`). Always read them with `CAST(col AS TEXT)`; bind preformatted strings (`platform.SQLTimeFormat`).
- **Pools:** `Store.W` is one connection with `_txlock=immediate`; `Store.R` is a read pool. All pragmas are in the DSN.
- **Schema:** `internal/store/schema/fresh.sql` is a copy of `testdata/schema/fresh.sql` (a test fails if they differ). Only missing tables are created.
- **Backups:** `VACUUM INTO` temp file, verify, rename. A same-second name collision gets a `-2` suffix (Python overwrote).
- **Not in Slice 1:** CSRF guard, sessions, `DEMO=1` seeding, tunnel, `before-migrate`/`before-delete` backups callers.

## Re-split of the remaining slices (replaces plan slices 3-8)

Reads in the fixtures depend on data their writes create, so the work is split by feature:

| Slice | Content |
|---|---|
| 3 | Platform accounts: organisations, users, roles, permissions, audit logs; reads and writes. Target: all 70 steps of scenario 01 |
| 4 | Reports module (catalogue, price history, store report, review, summary, settings) and `DEMO=1` seeding |
| 5 | XLSX import/export |
| 6 | System: backups, health, overview, tunnel |
| 7 | Packaging, Windows build, Playwright e2e against the Go binary |
| 8 | Cut-over |

## Session cookie
The locked Starlette writes the session cookie only when the session changes (login, logout): a fixed
7-day window, no sliding refresh. Go does the same.

## Deliberate differences from Python (Go-only expectations live in `internal/web/testdata/overrides.json`)
- Audit `ts` and `users.created_at` are served as RFC3339 UTC with `Z` (Q5).
- Deleting a user who still has roles works (Python returned 500).

## Slice 3 outcome
- All 70 steps of scenario 01 pass on fresh, `migrated_very_old` and `migrated_previous_release` with **no overrides**
  (`internal/web/testdata/overrides.json` is not needed yet). The ledger lists only `02_*` steps.
- `ts` is served as RFC3339 UTC with `Z`; the harness now requires the `Z` on `ts`/`created_at`/`last_backup_at`.
- Deletes remove child rows explicitly (`user_roles`, `role_permissions`, `report_settings`) and are tested on all three schemas.
- `core.Module.OrganisationUsage` decides archive-vs-delete; the reports module reports its report counts.
- The optional SPA click-through (needs Node build) is deferred to Slice 7.

## Slice 4 outcome
- Every non-XLSX step of scenario 02 passes on all three schemas. The ledger holds only the XLSX steps:
  `02_reports_catalog#38` (summary.xlsx) and `#55` (product import); both belong to Slice 5.
- Package layout rule: domain code (money, pricing, repo, seed) lives in `internal/reports` and imports only
  `core`/`platform`; HTTP handlers and DTOs live in `internal/web/reports.go`.
- Money parsing (`ToCents`) and pricing are tested against Python-generated golden files
  (`testdata/reports/gen_golden.py`).
- `core.Module.Seed` runs inside the first-run transaction when `DEMO` is set (products, `store1`/`store2`).
- Validation error `loc` parts are strings, as in Python (`str(part)`).
- Intentional differences: integer fields accept integral floats (R13/R23); `to_cents("1e999999")` returns a 422
  form error instead of Python's Overflow 500.
- Tests added: 30-goroutine concurrent save/read under `-race`, before-delete backup contains the deleted row,
  store scope isolation, Ukrainian (є/і/ї/ґ) settings ordering.
- Slice 4 smoke test (curl against the real Go binary, SPA build embedded, `DEMO=1`, throwaway `LEGKYI_DATA_DIR`):
  DEMO seed created store1/store2, login, store report save+submit, admin list/detail/summary/settings/products
  and transport status all returned 200 with the expected data.
  Browser e2e (`scripts/e2e_test.py` spawns the Python server and needs chromium) is deferred to Slice 7.
