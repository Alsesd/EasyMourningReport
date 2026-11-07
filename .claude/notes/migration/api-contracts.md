# API contracts: what a Go backend must reproduce

The endpoint list, the permissions and their purposes are in [`docs/API.md`](../../../docs/API.md). That table matches the routes in source, and this file does not repeat it. This file records the wire-level behaviour API.md leaves out. **(probed)** marks behaviour confirmed against a running server.

## Transport and routing

- JSON API under `/api/v1`. Only the SPA calls it, through `frontend/src/platform/api/client.ts`. The client:
  - sends `X-Requested-With: fetch`, `Accept: application/json`, `credentials: same-origin`;
  - reads `detail` (string), then `message`, then `errors[].msg` for error text.
- Outside `/api/v1`:
  - `/healthz` returns `{"status":"ok"}` after `SELECT 1`.
  - `/manifest.webmanifest`, `/sw.js` (`Cache-Control: no-cache`) and `/offline` are served as files.
  - `/static/*` comes from `backend/app/static`.
  - Any other GET returns `static/app/index.html`.
- `api`, `api/*`, `static` and `static/*` never fall back to the SPA.
- Unknown API path returns `404 {"detail":"Not Found"}`. Wrong method returns `405 {"detail":"Method Not Allowed"}` **(probed)**.
- Non-API errors return a small inline Ukrainian HTML page (`core/http_errors.py`), with the message escaped.

## Authentication and session

- **Cookie** `session`, from Starlette `SessionMiddleware`:
  - Value: `base64(json)` + `.` + timestamp + `.` + signature (itsdangerous `TimestampSigner`, HMAC-SHA1).
  - Attributes: `Path=/; Max-Age=604800; HttpOnly; SameSite=Lax`, plus `Secure` only if `COOKIE_SECURE=1`.
  - Payload is `{"uid": <int>}` **(probed)**. The 7-day age is checked from the signed timestamp.
  - The response carries `Vary: Cookie`.
- **Secret.** `SECRET_KEY` env var, otherwise `data/secret.key`, created as 64 hex characters with mode 0600.
- **Password hashes.** `"<16-byte salt hex>$<pbkdf2_hmac('sha256', pw, salt, 200000) hex>"`, compared in constant time. **These must stay valid.**
- **Login** (`POST /auth/login {login, password}`):
  - Success: 200 `SessionDTO` + `Set-Cookie`.
  - Wrong login or password: 401.
  - Disabled account or archived organisation: 403 «Цей обліковий запис вимкнено…».
  - Rate-limited: 429 with `Retry-After: <s>` and `Cache-Control: no-store`.
  - Limits are failures per 15 minutes, in memory, reset on restart: 5 per IP+login, 20 per IP, 30 per login. Success clears only the IP+login counter.
- **Any authenticated endpoint** returns 401 `{"detail":"Увійдіть у систему."}` when there is no session, the user is unknown or disabled, or the organisation is archived.
- **Permission failure**: 403 `{"detail":"Недостатньо прав для цієї дії."}`. Member-only endpoints called by a platform user: 403 «Лише для користувачів організацій.».
- **CSRF guard.** POST, PUT, PATCH and DELETE require `Origin` (or else `Referer`) with an http/https scheme whose host:port equals the `Host` header, case-insensitively. Otherwise the response is a **plain-text** 403, «Відхилено запит без перевірки джерела.» or «Відхилено запит з іншого джерела.» **(probed)**. This also applies to `/auth/login` and `/auth/logout`.
- **Client IP** for the audit log and rate limit: `X-Forwarded-For` is trusted only when the peer is in `FORWARDED_ALLOW_IPS` (default `127.0.0.1`, i.e. the local cloudflared).

## Error shapes

| Cause | Status | Body |
|---|---|---|
| `HTTPException` (not found, forbidden, conflict, bad period, …) | 400/401/403/404/409/429/500/503 | `{"detail": "<Ukrainian text>"}` |
| Business validation (`FormError`) | 422 | `{"detail": "<text>", "code": "validation_error"}` |
| Schema validation (Pydantic) | 422 | `{"detail": "Некоректні дані запиту.", "errors": [{"loc": ["body","name"], "msg": "String should have at least 1 character", "type": "string_too_short"}]}` |
| CSRF | 403 | plain text |

The UI shows `detail` for every shape except Pydantic errors. For Pydantic errors the frontend shows `detail` too, because it checks `detail` before `errors`. So the exact text of `errors[].msg` matters little, but its presence and shape should be kept.

## Validation rules (enforced server-side)

- **Period**:
  - Must match `^\d{4}-(0[1-9]|1[0-2])$`, otherwise 400 «Період має мати вигляд 2026-10».
  - When missing it defaults to the server's **local** current month.
  - This applies to both query parameters and path parameters.
- **Money input** (`core/dependencies.to_cents`):
  1. Remove spaces and replace `,` with `.`.
  2. Parse as a Decimal (rejecting inf and NaN).
  3. Multiply by 100 and round **half-to-even** (0.125 → 12, 0.135 → 14) **(probed)**.
  4. The result must be in 0..1,000,000,000; otherwise 422 FormError «Некоректна ціна. Приклад: 25.50».
- **Names.** Whitespace is collapsed, the result must be non-empty and at most 100 characters. The FormError text names the entity.
- **Logins.** Trimmed, lower-cased, matching `\S{2,40}`.
- **Passwords.** At least 6 characters; the DTO caps them at 256.
- **DTO length limits** come from Pydantic `Field`s in `*/schemas.py`, for example `quantities` ≤ 5000 items, `role_ids` ≤ 50, `permissions` ≤ 500, tunnel token ≤ 4096. Integer quantities are `ge=0` with **no upper bound**.
- **Lax coercion (probed).** Pydantic accepts `"1"` as an int, `2.0` as an int, and `true` as `1`. The SPA always sends real JSON numbers and booleans. Recommendation: do **not** promise lax coercion; return 422 for these inputs, but list them in the characterization suite as intentional differences.

## Serialization

- Field names are snake_case and match `frontend/src/platform/api/schema.d.ts`. Optional fields are emitted as `null`, never omitted. `MutationDTO` always contains `id`, `archived`, `deleted`, `message`.
- Datetimes:
  - `AuditLogDTO.ts` is `"2026-11-06T02:11:18.408373"`: microseconds, **no timezone**, value is UTC **(probed)**.
  - `BackupDTO.created_at` and `SystemHealthDTO.last_backup_at` are `"…T…Z"` with microseconds **(probed)**.
  - Python drops the fraction when microseconds are 0; Go must replicate that or accept the difference.
- Money is always integer `*_cents`.
- Lists keep server order. The frontend does not re-sort most of them.
- Ordering rules to copy:
  - `ORDER BY name` with SQLite BINARY collation: products, and organisations in reports/summary.
  - `ORDER BY login`: users.
  - Python `casefold()` sort: `/organisations`, `/reports/settings`.
  - Roles sort by (non-platform, custom, casefold(name)).
  - Audit log: id descending.

## Binary endpoints

- **`GET /admin/summary.xlsx?period&submitted_only`**:
  - Response headers: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `Content-Disposition: attachment; filename="zvit-YYYY-MM.xlsx"`.
  - The SPA opens it as a plain `<a download>` link, so it relies on the cookie and needs no CSRF check.
  - Workbook layout is described in `feature-inventory.md`.
- **`GET /admin/backup/download`**: `application/octet-stream`, attachment named after the snapshot file.
- **`POST /admin/products/import`** (multipart, field `file`):
  - File checks: the filename must end in `.xlsx`, otherwise 400. Empty or larger than 10 MB: 400.
  - Parsing:
    - Reads the active sheet, columns A (name) and B (price), with `data_only` (cached formula values).
    - Fully empty rows are skipped.
    - Row 1 is treated as a header if A1 casefolds to `name`, `назва`, `товар` or `product`.
    - The price cell is turned into a string with `str()` (so float `25.5` becomes `"25.5"`) and then passed to `to_cents`. Bool or empty price is an error.
  - Errors: any bad row aborts the whole import with 400 «Імпорт скасовано — виправте файл:» followed by up to 20 `рядок N: …` lines. An unreadable workbook: 400. No rows: 400.
  - Duplicates are skipped by **whitespace-normalised, case-sensitive** name, compared both against existing products and within the file.
  - Effects: one transaction, one audit row «масово додано товари».
  - Response: `{"message": "Імпорт завершено: додано N товарів, пропущено дублікатів: M."}`, or the «Нових товарів не додано…» variant.

## Characterization targets (to record from Python before porting)

For every endpoint in API.md, record, against a seeded DB copy:
1. Happy path as platform admin, as org admin, and as store user.
2. 401 without a cookie, 403 without the permission, and a 403 CSRF case for mutations.
3. 404 and 409 cases where they exist.
4. FormError 422 and schema 422.

Normalise ids, timestamps, backup names and IPs. Compare XLSX files by cell values, number formats, sheet name, freeze pane and auto-filter range.
