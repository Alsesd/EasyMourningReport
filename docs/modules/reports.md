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
- **Only days are locked.** The month is review-only: there is no monthly save, read for stores or lock.
- **An empty day cannot be submitted** (there are no days off): at least one quantity (or calculation quantity) must be entered; the server answers `422` and the submit button stays disabled with a hint. An empty draft may be saved.
- **Several employees of one store** fill in the same day: the draft is the store's, on the server, so everyone sees what a colleague saved, and the day shows «Востаннє зберіг(ла)». A save replaces the day's quantities, it never adds to them, so saving twice cannot double. The form sends the `revision` it loaded; if a colleague saved in between, the server refuses (`409`, naming the colleague) and the page offers «Оновити дані». A local (offline) draft made on an older revision is not restored over the newer save; the page says so.
- The month's `reports.status` is derived for a daily month: `submitted` when every day is.
- Stores see days only; the month as a whole (the sum) is shown to reviewers.

### Midnight close (`close.go`, `core.Module.DayClose`)

A day is open until midnight in `APP_TIMEZONE` (default Europe/Kyiv; "today" never comes from the machine's clock). After midnight the scheduler closes every ended day for each store that fills in reports (not archived, with an active `reports.submit` user):

- a draft day is locked as it is and marked **missed**; a store with no report for the day gets an empty locked day, also missed (a report row is created if needed); a submitted day is left alone; a month submitted as a whole is skipped;
- reviewers (`reports.review`) get one notification «Звіти не надіслано вчасно» listing store and date, linking to the day;
- `missed` stays after a reviewer unlocks the day and the store submits late; `/admin/missed-days` lists both («пізніше» for late ones), and the review page shows them in «Не надіслано вчасно»;
- a store cannot open a past day that has no report (`409`, `closed: true` on read); a day a reviewer unlocked is open until the next midnight, then closed again (without a new missed mark);
- each date is processed once (`report_day_close`); the first run ever closes nothing (it only records yesterday, so nobody is accused for a day before the rule existed; the first real check is the night after installation); later runs catch up after a downtime (at most 31 days back). A restart during the day closes nothing and does not re-lock days a reviewer reopened.

Auto-closed days are locked (status `submitted`) but carry no store submission, so they do not count as submitted (owner: count only submitted reports).
- Days: a date of the month up to today (server local time). Prices are monthly, so a day offers its month's prices.
- «Лише надіслані» and the dashboard's revenue count only days **the store submitted** (`status = 'submitted' AND submitted_at > 0`): a day closed at midnight or locked by a reviewer without a submission does not count, and the month is submitted only when the store submitted every day.

## Rules worth knowing

- A store (division) opens the current month and any month that already has a report of its own; other months answer 403 («Звіту за … не існує»).
- Saving as a draft is repeatable; **submit** locks the report (`409` on later saves). Only a holder of `reports.review` unlocks it, and then the division can edit and submit again.
- The server revalidates every product/price pair against the price history; if the product list or prices changed in the meantime, the save answers `409` and the page asks to refresh.
- Product import (`.xlsx`, at most 10 MB): column A the name, column B the price, a header row (`Назва`, `Name`, `Товар`, `Product`) is skipped; any bad row cancels the whole file (up to 20 problems are listed); names that already exist (archived included) or repeat in the file are skipped.
- Excel export of the month (`/admin/summary.xlsx`) mirrors the products matrix; the «По розрахунку» quantity appears in its own column and never counts towards money.

A report belongs to an organisation (`reports.store_id` → `organisations.id`; the column keeps its historic name). Members with `reports.submit` only ever reach their own organisation's report.

## Frontend

The store page opens today's day: a strip of the month's days (state per day) and the day form with «Зберегти чернетку» / «Надіслати день»; stores get no month view. Local offline drafts are kept per day. The reviewer's «Звіти» page has two tabs: **«За день»** (default; day selector `?day=`, register, matrix and Excel for that day) and **«За місяць»** (`?tab=month`, read-only register, matrix and Excel of the month). The report detail shows «Місяць» (read-only sum, no lock) and the filled days; a day (`?day=`, the notification link) has «Заблокувати день» / «Розблокувати день».

`module.tsx` registers the store report (`/report`, an absolute path rendered inside the shell, so stores have the same navigation as everyone), the «Звіти» page (`/admin/reports`), the report detail page, the «Товари й ціни» and «Звіти підрозділів» sections (the latter switches «По розрахунку» per division) of «Адміністрування», and the landing pages. `api.ts` wraps the endpoints, `i18n.ts` extends the platform dictionary, and `permissions.ts` mirrors the backend codes.

## Tests

```bash
go test ./internal/reports ./internal/web
cd frontend && npm test -- src/modules/reports
```

## Who submitted a day

Every day carries the employee who submitted it and the reviewer who locked it (`report_days`): `submission: {by, signed_at}` ("Надіслав(ла)"; kept after an unlock as "Востаннє надіслав(ла)" until the store submits again) and `locked: {by, signed_at}` ("Заблокував(ла) адміністратор", only while the day is submitted and the lock is newer than the submission). `saved: {by, signed_at}` names the employee who saved the day last. The month itself carries no signature.
