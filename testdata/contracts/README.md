# HTTP contract scenarios

Language-neutral characterization of the REST API. They were first recorded from the Python implementation and are
now the expected behaviour of the Go server; `internal/web/contract_test.go` replays them with `httptest` on a fresh
database. Edit them only for intended behaviour changes and say why in the commit.

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
- `expect.json` is compared exactly after volatile values are replaced: `ts`, `created_at`, `last_backup_at`, `signed_at` by `"<time>"`, the current month by `"<current-period>"`, a date of the current month by `"<current-month-date>"`, and today's date inside a text by `<today>`. Binary responses record `content_type` only.
