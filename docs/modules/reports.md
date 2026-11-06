# Reports module

**Backend:** `internal/reports/` (domain, SQL, HTTP handlers `http*.go`) · **Frontend:** `frontend/src/modules/reports/`

Monthly store reports: product catalogue with price history, report entry by organisation members, review, combined summary with Excel export, and per-organisation report settings.

## Backend

| File | Owns |
|---|---|
| `module.go` | The `core.Module` definition: permissions, audit actions, default grants |
| `pricing.go` | Pure price-history rules |
| `money.go` | Price parsing to cents and formatting |
| `repo.go` | Queries: products, report lines, the summary matrix |
| `xlsx_import.go`, `xlsx_export.go` | Product import and summary export |
| `seed.go`, `overview.go`, `usage.go` | Demo data, overview figures, organisation usage |
| `submissions.go` | The report's signature (who submitted or locked it), in the Go-owned side table `report_submissions` |
| `http.go`, `http_xlsx.go` | REST endpoints, listed in `Module.Routes` (see `docs/API.md`) |

A report belongs to an organisation (`reports.store_id` → `organisations.id`; the column keeps its historic name). Members with `reports.submit` only ever reach their own organisation's report.

## Frontend

`module.tsx` registers the standalone store report (`/report`), the «Звіти» month page (`/admin/reports`: store register, products matrix, Excel; `/admin/summary` redirects there), the report detail page, the «Товари й ціни» and «Звіти організацій» sections of «Адміністрування», and the landing pages. `api.ts` wraps the endpoints, `i18n.ts` extends the platform dictionary, and `permissions.ts` mirrors the backend codes.

## Tests

```bash
go test ./internal/reports ./internal/web
cd frontend && npm test -- src/modules/reports
```

## Who submitted a report

Every report carries the employee who submitted it, next to the organisation it belongs to. `PUT /store/reports/{period}` with `action: "submit"` records the signed-in employee (id and a name snapshot: full name, else login). The responses of the store page, the administrator's month list and the report detail carry:

- `submission: {by, signed_at}`: the employee who submitted the report ("Надіслав(ла)"). It stays after an administrator unlocks the report ("Востаннє надіслав(ла)") until the store submits again.
- `locked: {by, signed_at}`: an administrator locked the report ("Заблокував(ла) адміністратор"). Present only while the report is submitted and the lock is newer than the last submission, so the correction cycle (submit, unlock, lock again without a resubmit) shows both the employee and the administrator. Locking a report that is already submitted changes nothing.
- Both are absent for reports submitted before this was recorded (nothing is guessed) and for drafts that were never submitted.

The signatures live in the side table `report_submissions` (one row per report and kind: `store` or `admin`; `internal/store/schema.go`, `goOwned`), because the `reports` table mirrors the Python release and is never altered. The Excel summary has no per-report row, so the export is unchanged and its golden files are untouched.
