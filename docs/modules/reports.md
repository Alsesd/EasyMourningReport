# Reports module

**Backend:** `internal/reports/` (domain, SQL, HTTP handlers `http*.go`) · **Frontend:** `frontend/src/modules/reports/`

Daily store reports summed into months: product catalogue with price history, report entry by organisation members, review, combined summary with Excel export, and per-organisation report settings.

## Backend

| File | Owns |
|---|---|
| `module.go` | The `core.Module` definition: permissions, audit actions, default grants |
| `pricing.go` | Pure price-history rules |
| `money.go` | Price parsing to cents and formatting |
| `repo.go` | Queries: products, report lines, the summary matrix |
| `xlsx_import.go`, `xlsx_export.go` | Product import and summary export |
| `seed.go`, `overview.go`, `usage.go` | Demo data, overview figures, organisation usage |
| `dashboard.go` | The blocks this module supplies to the management dashboard (revenue, drafts, submission rate, 12-month series, divisions, top products). Only submitted reports count as revenue |
| `days.go`, `http_days.go` | Daily reports: day storage, the month aggregate, derived month status, the day endpoints |
| `submissions.go` | The report's signature (who submitted or locked it), in the Go-owned side table `report_submissions` |
| `http.go`, `http_xlsx.go` | REST endpoints, listed in `Module.Routes` (see `docs/API.md`) |

## Daily reports

A store fills in **each day** of the month; the month is the sum of its days. Each day is saved as a draft, **submitted** (signed by the employee, reviewers notified with a link to that day) and **locked/unlocked** by a reviewer on its own.

- Storage: Go-owned tables `report_days` (status and signatures per day) and `report_day_items` (quantities per day). `report_items` stays the month's aggregate and is rebuilt from the days in the same transaction as every day save (for the products a store can edit; inactive and archived products' rows never change), so the summary, the Excel export, the dashboard and product usage read it as before.
- A month with no day rows is "kept as a whole" (everything before daily reports). The first day saved in it moves its existing quantities, status and signatures into the **undated** part (`day = ''`, «Без дати» in the UI, `undated` in URLs): nothing entered before is lost, and the undated part can still be corrected and submitted like a day.
- **Only days are locked.** The month of a daily report is review-only: `PATCH /admin/reports/{id}` answers `409` for it, and the UI offers no month lock at all (also not for months kept as a whole: their quantities are the «Без дати» part, locked and unlocked like a day). A daily month always takes new days, also a past one (a forgotten day arrives as a draft).
- A month submitted as a whole takes no days until a reviewer unlocks its «Без дати» part. The monthly `PUT /store/reports/{period}` refuses a daily month (`409`).
- The month's `reports.status` is derived for a daily month: `submitted` when every day is.
- Stores see days only; the month as a whole (the sum) is shown to reviewers.

### Midnight close (`close.go`, `core.Module.DayClose`)

A day is open until midnight in `APP_TIMEZONE` (default Europe/Kyiv; "today" never comes from the machine's clock). After midnight the scheduler closes every ended day for each store that fills in reports (not archived, with an active `reports.submit` user):

- a draft day is locked as it is and marked **missed**; a store with no report for the day gets an empty locked day, also missed (a report row is created if needed); a submitted day is left alone; a month submitted as a whole is skipped;
- reviewers (`reports.review`) get one notification «Звіти не надіслано вчасно» listing store and date, linking to the day;
- `missed` stays after a reviewer unlocks the day and the store submits late; `/admin/missed-days` lists both («пізніше» for late ones), and the review page shows them in «Не надіслано вчасно»;
- a store cannot open a past day that has no report (`409`, `closed: true` on read); a day a reviewer unlocked is open until the next midnight, then closed again (without a new missed mark);
- each date is processed once (`report_day_close`); the first run ever closes nothing (it only records yesterday, so nobody is accused for a day before the rule existed; the first real check is the night after installation); later runs catch up after a downtime (at most 31 days back). A restart during the day closes nothing and does not re-lock days a reviewer reopened.

Auto-closed days have status `submitted`, so they count in «Лише надіслані» and in revenue: what the store had entered by midnight is taken as the day's report.
- Days: a date of the month up to today (server local time). Prices are monthly, so a day offers its month's prices.
- «Лише надіслані» and the dashboard's revenue count submitted days of daily months (and submitted months kept as a whole).

## Rules worth knowing

- A store (division) opens the current month and any month that already has a report of its own; other months answer 403 («Звіту за … не існує»).
- Saving as a draft is repeatable; **submit** locks the report (`409` on later saves). Only a holder of `reports.review` unlocks it, and then the division can edit and submit again.
- The server revalidates every product/price pair against the price history; if the product list or prices changed in the meantime, the save answers `409` and the page asks to refresh.
- Product import (`.xlsx`, at most 10 MB): column A the name, column B the price, a header row (`Назва`, `Name`, `Товар`, `Product`) is skipped; any bad row cancels the whole file (up to 20 problems are listed); names that already exist (archived included) or repeat in the file are skipped.
- Excel export of the month (`/admin/summary.xlsx`) mirrors the products matrix; the «По розрахунку» quantity appears in its own column and never counts towards money.

A report belongs to an organisation (`reports.store_id` → `organisations.id`; the column keeps its historic name). Members with `reports.submit` only ever reach their own organisation's report.

## Frontend

The store page opens today's day: a strip of the month's days (state per day, «Без дати» when present) and the day form with «Зберегти чернетку» / «Надіслати день»; stores get no month view. Local offline drafts are kept per day. The reviewer's «Звіти» page has two tabs: **«За день»** (default; day selector `?day=`, register, matrix and Excel for that day) and **«За місяць»** (`?tab=month`, read-only register, matrix and Excel of the month). The report detail shows «Місяць» (read-only sum, no lock) and the filled days; a day (`?day=`, the notification link) has «Заблокувати день» / «Розблокувати день».

`module.tsx` registers the standalone store report (`/report`), the «Звіти» month page (`/admin/reports`: store register, products matrix, Excel; `/admin/summary` redirects there), the report detail page, the «Товари й ціни» and «Звіти підрозділів» sections (the latter switches «По розрахунку» per division) of «Адміністрування», and the landing pages. `api.ts` wraps the endpoints, `i18n.ts` extends the platform dictionary, and `permissions.ts` mirrors the backend codes.

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
