# Reports module

**Backend:** `internal/reports/`, `internal/web/reports*.go` · **Frontend:** `frontend/src/modules/reports/`

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
| `internal/web/reports.go`, `reports_xlsx.go` | REST endpoints (see `docs/API.md`) |

A report belongs to an organisation (`reports.store_id` → `organisations.id`; the column keeps its historic name). Members with `reports.submit` only ever reach their own organisation's report.

## Frontend

`module.tsx` registers the standalone store report (`/report`), the «Звіти» month page (`/admin/reports`: store register, products matrix, Excel; `/admin/summary` redirects there), the report detail page, the «Товари й ціни» and «Звіти організацій» sections of «Адміністрування», and the landing pages. `api.ts` wraps the endpoints, `i18n.ts` extends the platform dictionary, and `permissions.ts` mirrors the backend codes.

## Tests

```bash
go test ./internal/reports ./internal/web
cd frontend && npm test -- src/modules/reports
```
