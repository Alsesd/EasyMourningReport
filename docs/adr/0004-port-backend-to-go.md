# ADR 0004: Port the backend from Python to Go

## Status

Accepted and implemented (release tag `Soup.V5`). Supersedes the Python-specific parts of ADR 0001 (layout) and ADR 0002 (uv). ADR 0003 (keep SQLite) still holds.

## Context

The application ran as a FastAPI + SQLModel process with a React front end, in one Docker container. We wanted one self-contained binary (including a Windows `.exe` with data next to it), a small runtime image and no interpreter or dependency environment to maintain.

## Decision

- The backend is a Go program using the standard library (`net/http`, `database/sql`) with hand-written SQL, `modernc.org/sqlite` (pure Go, no CGO) and `excelize` for XLSX. The React build is embedded with `embed.FS`.
- Behaviour was kept identical and verified slice by slice (see `.claude/notes/migration/`): the same database file and schema, the same PBKDF2 password hashes, the same REST contract and error shapes, the same backups, the same tunnel supervision. The recorded HTTP scenarios, golden XLSX files and money/pricing tables in `testdata/` were produced by the Python implementation and are now frozen fixtures.
- Deliberate differences: sessions are signed with a new cookie format (everyone signs in once more); audit times are served as UTC with a `Z`; some inputs that crashed the Python app with HTTP 500 now return proper errors; `DEMO=0` really disables the demo data.
- The Python migrations are not ported. Databases must already carry the three recorded migration ids (they do after any run of the last Python release, commit `92564ef`).
- `schema.d.ts` is no longer generated from OpenAPI and is maintained by hand.

## Consequences

- Build and test with `go` and `npm`; `uv` remains only for the Playwright smoke test script.
- Rolling back means the previous image or commit `92564ef` plus a backup taken before the switch.
- A new table is added in `internal/store/schema/fresh.sql` and an idempotent step in `internal/store/schema.go`.
