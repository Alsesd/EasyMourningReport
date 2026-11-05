# ADR 0003: Keep SQLite, hardened, instead of an embedded PostgreSQL

- Status: Accepted
- Date: 2026-11-05

## Context

The platform is growing beyond monthly reports: transport orders will be added. Two concerns raised the question of moving to PostgreSQL, ideally run by the app itself with no separate container:

1. **Power and internet cuts in Ukraine.** The server may lose power at any moment.
2. **SQLite allows one writer at a time.** Will concurrent users block each other?

The candidates were an embedded PostgreSQL that the app starts itself (e.g. the `pgserver` package), PostgreSQL next to the app in the same container under a supervisor, or SQLite with hardening.

## Measurements (4-core container, 200-product catalogue)

| Test | Result |
|---|---|
| Raw SQLite, 8 processes each committing "report saves" (delete 200 rows + insert 200 rows), `synchronous=FULL` | **886 saves/s** in rollback-journal mode, **1,890 saves/s** in WAL mode |
| Through the app, 50 stores saving full reports back-to-back + 5 reviewers reloading the summary | 0 errors, 0 "database is locked", 0 pool timeouts |
| One report save, before / after fixing the app (see below) | 109 ms → **29 ms** |

The load test found two application problems, both fixed. Neither was in the database:

- Replacing a report's rows through the ORM collection compared SQLModel objects field by field (`list.remove` + pydantic `__eq__`). That was about 32,000 comparisons per save, 80 % of the request time. Rows are now deleted and inserted directly.
- SQLAlchemy's default pool of 15 connections was smaller than the 40 request threads, so a burst produced 500s after a 30 s wait. The pool is now sized to the thread pool.

What remains is the Python process itself: ~7–10 saves/s for one process at full saturation. A real month-end, even at 50 stores, is well under one save per second. Beyond that, the next step would be several app processes, which SQLite supports, not a different database.

## Decision

Keep SQLite, embedded in the app process, and harden it:

- `synchronous=FULL`, so a committed transaction survives a power cut.
- WAL journal on local disks (readers never block the writer). The classic rollback journal is used on shared/network folders, where WAL's shared-memory file is unsafe; Docker Desktop host folders count as shared. Detected from `/proc/mounts`; override with `SQLITE_JOURNAL_MODE`.
- Integrity check (`PRAGMA quick_check`) at every start-up. A failure is logged loudly and shown in «Адміністрування».
- Every backup is a single self-contained file and is verified. A backup that fails the check is deleted and reported. The skip-if-unchanged test also looks at the WAL file, so changes are never missed.
- WAL checkpoint and a final backup on clean shutdown.

## Why not PostgreSQL now

- **Power cuts:** PostgreSQL is no safer than SQLite with `synchronous=FULL`. Both recover from their write-ahead logs. An embedded PostgreSQL adds a second process that must be shut down cleanly, plus a data directory whose major-version upgrades need `pg_upgrade`.
- **One writer:** the measured write capacity is roughly 1,000× the expected load. The writer lock was never the bottleneck.
- **Operations:** backups stay "copy one verified file". Restore is "stop, replace `reports.db`, start". No extra memory, binaries or Windows-specific packaging.

## When to revisit

- Many app processes or several servers writing to the same data.
- Sustained write load measured above ~100 saves/s, or reporting queries that need PostgreSQL features.
- A need for point-in-time recovery beyond hourly verified backups.

Moving would then mean adding a `DATABASE_URL` setting, porting the few SQLite-specific migration statements (`PRAGMA table_info`, `ALTER TABLE … RENAME`), and a one-off data copy. The old `scripts/sqlite_to_postgres.py` helper was removed as unused. It remains in git history and would need updating for the current schema.

## Recommended next step for outages

Copy backups off the machine whenever internet is available (for example a scheduled `rclone copy app_storage/backups remote:zvit-backups`). A UPS for the server lets it shut down cleanly.
