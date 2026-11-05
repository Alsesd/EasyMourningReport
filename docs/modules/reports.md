# Reports module

**Backend:** `backend/app/modules/reports/` · **Frontend:** `frontend/src/modules/reports/`

Monthly store reports: product catalogue with price history, report entry by organisation members, review, combined summary with Excel export, and per-organisation report settings.

## Backend

| File | Owns |
|---|---|
| `__init__.py` | The `Module` definition |
| `models.py` | `Product`, `ProductPrice`, `Report`, `ReportItem`, `ReportSettings` |
| `pricing.py` | Pure price-history rules |
| `products_repo.py`, `reports_repo.py` | Queries, report lines and the summary matrix |
| `excel.py` | Product import and summary export |
| `routes.py`, `schemas.py` | REST endpoints and DTOs (see `docs/API.md`) |
| `permissions.py` | `reports.submit`, `reports.review`, `reports.catalog.manage`, `reports.settings.manage`, audit actions |
| `migrations.py` | Upgrades from older releases |
| `seed.py` | Demo data |

A report belongs to an organisation (`reports.store_id` → `organisations.id`; the column keeps its historic name). Members with `reports.submit` only ever reach their own organisation's report.

## Frontend

`module.tsx` registers the standalone store report (`/report`), the summary and report pages, the «Товари» and «Звіти організацій» settings sections, and the landing pages. `api.ts` wraps the endpoints, `i18n.ts` extends the platform dictionary, and `permissions.ts` mirrors the backend codes.

## Tests

```bash
uv run pytest backend/app/modules/reports
cd frontend && npm test -- src/modules/reports
```
