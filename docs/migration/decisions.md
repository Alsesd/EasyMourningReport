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
