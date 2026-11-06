# HTTP contract scenarios

Language-neutral characterization of the REST API (see `docs/migration/api-contracts.md`).
These files were recorded from the Python implementation (commit `92564ef`, `backend/app/tests/test_contracts.py`)
and are now frozen. `internal/web/contract_test.go` replays them with `httptest`. The Python generators (`gen_golden.py`,
`gen_xlsx_golden.py` in `testdata/reports/`) were removed with the Python backend; edit the fixtures by hand only for intended behaviour changes.

A scenario is a JSON file:

```json
{
  "description": "…",
  "seed": {"platform_admin": {"login": "boss", "password": "boss-pass"}},
  "steps": [
    {"name": "…", "as": "boss", "method": "POST", "path": "/api/v1/organisations",
     "json": {"name": "Shop"}, "save": {"org_id": "id"},
     "expect": {"status": 201, "json": {"…": "…"}}}
  ]
}
```

- The implementation starts with an empty database holding only the built-in roles and the seeded platform administrator.
- `as` names a client with its own cookie jar (default `anon`). Logging in is an ordinary step.
- `{name}` in `path` or `json` is replaced by a value saved earlier (`save`: name → dotted path into the JSON response). A string that is exactly `{name}` keeps the saved value's type.
- Requests carry `Origin: http://testserver` unless `"no_origin": true`.
- `multipart: {filename, path}` uploads a file (path relative to this directory) as the `file` field.
- `expect.json` is compared exactly after volatile fields (`ts`, `created_at`, `last_backup_at`) are replaced by `"<time>"`. Binary responses record `content_type` only.
- Refresh expectations from Python with `CONTRACTS_RECORD=1`; review the diff by hand.
