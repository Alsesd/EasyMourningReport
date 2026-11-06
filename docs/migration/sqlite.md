# SQLite: schema, transactions, compatibility

## Connection settings (`backend/app/db/session.py`)

| Setting | Value |
|---|---|
| File | `<data>/reports.db` |
| Per-connection pragmas | `foreign_keys=ON`, `journal_mode=<WAL or DELETE>`, `synchronous=FULL` |
| Busy wait | `timeout=30` (pysqlite busy timeout, 30 s) |
| Pool | 10 + 30 overflow, `check_same_thread=False` |

`journal_mode` choice:
- `SQLITE_JOURNAL_MODE=wal|delete` wins.
- Otherwise, on Linux, `delete` if the data folder sits on a shared filesystem according to `/proc/mounts` (9p, cifs, nfs, virtiofs, grpcfuse, …).
- Otherwise `wal`. Windows therefore always gets `wal`.

## Current schema (fresh database created by the current release, **probed**)

Tables, as created by SQLAlchemy `create_all`. `INTEGER NOT NULL PRIMARY KEY` means rowid aliases.

| Table | Columns | Keys / constraints |
|---|---|---|
| `organisations` | id, name VARCHAR, archived BOOLEAN | UNIQUE INDEX `ix_organisations_name`, INDEX archived |
| `users` | id, login, password_hash, full_name DEFAULT '', active BOOLEAN DEFAULT '1', organisation_id NULL, created_at DATETIME NULL | UNIQUE INDEX login, INDEX organisation_id, FK organisation_id → organisations (no cascade) |
| `roles` | id, "key" NULL, name, scope, organisation_id NULL | UNIQUE(name, organisation_id): NULLs are distinct, so the app enforces it for platform and shared roles. UNIQUE INDEX key, INDEX scope, INDEX organisation_id. FK organisation_id → organisations ON DELETE CASCADE |
| `role_permissions` | role_id, permission | PK(role_id, permission), FK → roles ON DELETE CASCADE |
| `user_roles` | user_id, role_id | PK(user_id, role_id), FKs ON DELETE CASCADE |
| `audit_log` | id, ts DATETIME, login, role, action, detail, ip | INDEX ts, login, action |
| `products` | id, name, price_cents, active BOOLEAN, archived BOOLEAN | no unique name |
| `product_prices` | id, product_id, period VARCHAR, price_cents | UNIQUE(product_id, period), INDEX product_id, period, FK → products (no cascade) |
| `reports` | id, store_id, period, status | UNIQUE(store_id, period), INDEX store_id, period, status, FK store_id → organisations (no cascade) |
| `report_items` | id, report_id, product_id, quantity, quantity_calc DEFAULT '0', unit_price_cents | INDEX report_id, product_id, FKs → reports and products (no cascade) |
| `report_settings` | organisation_id PK, calculation_enabled BOOLEAN DEFAULT '0' | FK → organisations ON DELETE CASCADE |
| `schema_migrations` | id VARCHAR PK, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP | |

Relationships:

```text
organisations 1─* users, 1─* roles (org-specific), 1─* reports (store_id), 1─1 report_settings
users *─* roles via user_roles
roles 1─* role_permissions (codes are strings, not FK; unknown codes ignored)
products 1─* product_prices, 1─* report_items
reports 1─* report_items
```

How values are stored (**probed**):
- **Booleans** are integers `0`/`1`.
- **Datetimes** are TEXT, `YYYY-MM-DD HH:MM:SS.ffffff`, naive, holding UTC: `audit_log.ts`, `users.created_at`. `users.created_at` is NULL for users that came through the legacy migration.
- **`schema_migrations.applied_at`** is `YYYY-MM-DD HH:MM:SS`, written by SQLite.
- **Periods** are TEXT `YYYY-MM`. Price-history periods are `0000-00` for the base row, then `YYYY-MM` or `YYYY-MM_N`. Legacy rows may use `YYYY-MM#…`.
- **Status** values: reports use `draft` or `submitted`; the API uses `new` or `none` for a missing report.

## Production databases may differ from a fresh one

Older databases reach the current shape through migrations, not through `create_all`. Their DDL text differs. For example, `organisations` is the renamed `stores` table, columns were added with `ALTER TABLE … ADD COLUMN … DEFAULT …`, and `users.role` was dropped. `backend/app/tests/test_migrations.py` replays two legacy schemas.

The Go side must therefore:
- **Never** compare DDL text. Compare `PRAGMA table_info`, `index_list` and `foreign_key_list`.
- **Never** recreate tables on start. Only create tables that are missing, using DDL copied from a fresh Python database.
- Treat column order as unspecified and always name columns in SQL.

## Migrations

Runner: `backend/app/db/migrations.py`.
- Migrations are applied in registry order: platform, then reports, then transport.
- Each one runs in its own transaction and is recorded in `schema_migrations`.
- A `before-migrate` backup is taken before the first pending migration.
- A module whose tables don't exist yet is *baselined*: its ids are recorded without running.

Applied ids today: `platform.0001_organisations_and_roles`, `reports.0001_legacy_columns`, `reports.0002_settings_table`.

## Transaction boundaries (per request)

- Each request gets one SQLAlchemy session, i.e. one transaction committed explicitly in the route. Audit rows are written in the same transaction as the change they describe.
- Some reads happen before the write in the same transaction. Examples:
  - store report save: periods, existing report, then delete and insert items;
  - user update: the last-admin check after a flush.

  Under WAL with deferred transactions, a read-then-write transaction can hit `SQLITE_BUSY` when another writer commits first. Python mostly avoids this by luck and low load. Go should open write transactions with `BEGIN IMMEDIATE`.
- **Hard deletes:**
  - Organisations and products take a `before-delete` backup **before** the delete transaction.
  - An organisation delete removes its users and roles explicitly, then the organisation. `report_settings` goes through the FK cascade.
  - A role delete removes `user_roles` explicitly; `role_permissions` go through ORM delete-orphan. Go must delete them explicitly or rely on the FK cascade (declared, and `foreign_keys=ON`).
- Excel import runs in one transaction with a flush per product.
- **Login failures commit an audit row**, so they are writes too.

## Backups and consistency

- The online backup API (`sqlite3.Connection.backup`) produces a consistent snapshot while the app runs. It is then converted to the DELETE journal and checked with `quick_check`.
- The proposed Go equivalent is `VACUUM INTO '<tmp>'`, then rename, set `journal_mode=DELETE` and run `quick_check`:
  - Same consistency guarantee.
  - The output is compacted, so file sizes differ, which is harmless.
  - `VACUUM INTO` fails if the target exists. Python's timestamp naming has one-second resolution, and two backups in the same second would overwrite under Python but fail under Go. Handle it explicitly.
- Restore is manual: stop, replace `reports.db`, delete any stale `-wal`/`-shm`, start.

## Go driver notes (modernc.org/sqlite; to verify in the skeleton slice)

- Put every pragma in the DSN (`_pragma=foreign_keys(1)&_pragma=busy_timeout(30000)&_pragma=synchronous(FULL)&_pragma=journal_mode(...)`), so each pooled connection gets them.
- For DATETIME columns, scan into `string` (or `sql.NullString`) and write preformatted UTC strings in the Python format. Do not bind `time.Time`: the driver's default text format differs, and mixed formats break ordering. (Reviewer claim, not yet verified here.)
- Scan BOOLEAN columns into `int64` or `bool`, explicitly.
- Use a single write connection, or `_txlock=immediate`, plus a read pool. At the measured load (ADR 0003) this costs nothing.
- **Python and Go must never open the same database file at the same time,** including during a trial cut-over on the same bind mount.
