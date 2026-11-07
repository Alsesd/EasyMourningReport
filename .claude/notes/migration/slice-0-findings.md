# Slice 0 (characterization): what exists and what it found

## Artifacts

- `testdata/contracts/*.json`: language-neutral HTTP scenarios (format in its README). Replayed by `backend/app/tests/test_contracts.py`; the Go suite will replay the same files. Two scenarios, about 135 steps: auth/CSRF/accounts/roles/audit, and catalogue/price history/store reports/review/summary/settings/static routes.
- `testdata/schema/{fresh,migrated_very_old,migrated_previous_release}.sql`: verbatim `sqlite_master` DDL plus recorded migration ids, checked by `backend/app/tests/test_schema_snapshots.py`. Go creates missing tables from this DDL.
- Refresh: `CONTRACTS_RECORD=1` / `SCHEMA_RECORD=1` with the same pytest files, then review the diff.

## Not yet covered (still open for Slice 0)

- XLSX import with real files and a cell-level export check (needs samples, plan Q7).
- Tunnel/backup/health endpoints (`/admin/tunnel`, `/admin/backups`, `/admin/system/health`, `/admin/overview`, `/admin/backup/download`): they depend on the filesystem and cloudflared, so they need their own harness.
- Rate limit (429) and client-IP trust.
- Python-made password hashes for the Go verifier, and money-parse cases.
- Concurrency and shutdown.

## Existing Python defects found (not changed; decide whether Go copies them)

1. **`DELETE /users/{id}` returns 500 for any user that has a role.** `delete_user` runs `delete(UserRole)` and then `db.delete(user)`; the loaded `roles` relationship makes the ORM issue a second DELETE on `user_roles`, which raises `StaleDataError`. Reproduced for both a platform admin and an org admin deleting a role-holding user. Deleting a user with no roles works. No existing test covers it. Go should simply delete the user and its role links. Fixing Python first (one line) is advisable because it is a live production bug.
2. Creating a product with a name that already exists is allowed on the manual path (`POST /admin/products`), while the XLSX import skips duplicates. Recorded as is.
3. `/api/nope` (outside `/api/v1`) returns the HTML 404, not JSON; only `/api/v1/*` 404s are JSON.
