# REST API v1

The web UI for administration and store reports uses a versioned, same-origin JSON API. Existing session-cookie authentication is reused; there are no bearer tokens, duplicated identities, or new auth dependencies.

## Contract

- Base path: `/api/v1`
- Requests and responses use JSON except binary exports.
- Prices and calculated amounts are integer **cents** in DTOs. Send editable price values as strings (for example `"12.50"`) so decimal parsing remains server-side and supports comma decimals.
- Product DTO `month_prices_cents` is the full in-month timeline: the price at the start of the month followed by every price change, including a return to an earlier amount. `price_history` contains every saved history event, in chronological/sequence order.
- Every resource response is a DTO, not a serialized SQLModel/ORM instance. Password hashes and persistence-only fields are never exposed.
- The browser uses the existing signed session cookie. Unauthenticated requests return `401`, missing permissions return `403`, missing resources return `404`, conflicting state returns `409`, and invalid payloads return `422`.
- Unsafe methods (POST, PUT, PATCH, DELETE) require a same-origin `Origin` or `Referer` header. Browser `fetch` supplies the origin automatically for these requests.
- Outside `/api/v1` the server only serves the SPA, PWA files (`/manifest.webmanifest`, `/sw.js`, `/offline`) and the container health probe `GET /healthz`.

## Access control

Every endpoint names the permission codes it needs; holding any one of them is enough. Permissions come from roles (see `docs/architecture.md`). *Platform* permissions belong to staff accounts without an organisation; *organisation* permissions belong to members of one organisation and only ever reach that organisation's data. `GET /permissions` lists every code with its module, scope and Ukrainian label.

## Platform endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/auth/login`, `/auth/logout` | — | Sign in / out |
| POST | `/auth/passkey/options`, `/auth/passkey` | — | Biometric (WebAuthn) sign-in: get a challenge, post the signed assertion |
| GET, POST, DELETE | `/passkeys`, `/passkeys/options`, `/passkeys/{id}` | any signed-in user | List, register (two steps) and remove your own passkeys |
| GET | `/session` | signed in | Identity, organisation, roles, effective `permissions`, installed `modules`, current period |
| PUT | `/me/password` | signed in | Change own password |
| GET | `/permissions` | `platform.roles.manage`, `platform.users.manage` or `org.users.manage` | Permission catalogue from all modules |
| GET | `/organisations` | `platform.organisations.manage`, `platform.users.manage` or `platform.roles.manage` | Organisations with user counts and per-module `usage` |
| POST | `/organisations` | `platform.organisations.manage` | Create; optional `first_user` gets the built-in «Магазин» role (also needs `platform.users.manage`) |
| PUT | `/organisations/{id}` | `platform.organisations.manage` | Rename |
| DELETE | `/organisations/{id}` | `platform.organisations.manage` | Archive if any module holds data for it; otherwise delete it with its users and roles |
| POST | `/organisations/{id}/restore` | `platform.organisations.manage` | Restore |
| GET | `/users?organisation_id=&platform=` | `platform.users.manage` or `org.users.manage` | Accounts; organisation managers always get only their own organisation |
| POST | `/users` | same | Create; organisation managers can only create in their organisation and assign roles whose permissions they hold |
| PUT | `/users/{id}` | same | Login, name, organisation, roles, active flag. The last active administrator cannot be disabled or demoted; nobody can disable themselves |
| PUT | `/users/{id}/password` | same | Reset a password |
| DELETE | `/users/{id}` | same | Delete an account (audit-log rows keep the login) |
| GET | `/roles?organisation_id=` | `platform.roles.manage`, `platform.users.manage` or `org.users.manage` | All roles for platform managers; assignable roles otherwise |
| POST / PUT / DELETE | `/roles`, `/roles/{id}` | `platform.roles.manage` | Custom roles. Built-in roles cannot be deleted; «Адміністратор» and «Адміністратор організації» always hold every permission of their scope |
| GET | `/admin/log-actions`, `/admin/logs?login=&action=&limit=200` | `platform.audit.view` | Audit-log filter values and entries |
| GET | `/admin/overview` | signed in | «Адміністрування» overview: account counts, tunnel, database health, recent activity, module figures. Each part is present only when the caller may see it |
| GET | `/dashboard` | `management.dashboard.view` | Management dashboard for `period` (`YYYY-MM`, default current month): `{period, blocks: [{key, title, description, tiles, series, lists}]}`. The `management` module serves it; the blocks are supplied by the other modules (reports: revenue, drafts, submission rate, 12-month series, divisions, top products; transport: month figures and the present). The permission is view-only and is the only gate: holding `reports.review` or `transport.orders.manage` does not open it. Figures carry a unit (`count`, `money_cents`, `percent`, `minutes`). Revenue counts submitted reports only and equals the summary's grand total; drafts are a separate tile. A transport order belongs to the month of its service date |
| GET | `/admin/tunnel` | `platform.system.manage` | Tunnel status: `state` is disabled, stopped, starting, running or error; `public_url`; `has_token` (the token itself is never returned) |
| POST | `/admin/tunnel` | `platform.system.manage` | `{confirm_public: true, token?, autostart}`. Starts cloudflared; a token is saved for later starts. `503` with `detail` if it cannot start |
| PUT | `/admin/tunnel/autostart` | `platform.system.manage` | `{enabled}`: start the tunnel with the app |
| GET | `/admin/sessions` | `platform.users.manage` | Every signed-in device of every employee: user, organisation, device (browser · system), address, sign-in time, last activity (refreshed about every 10 minutes), `current` for the caller's own |
| DELETE | `/admin/sessions/{id}` | `platform.users.manage` | End one session (audit: «завершено сеанс користувача») |
| DELETE | `/admin/sessions?user_id=N` | `platform.users.manage` | Sign a user out of every device |
| GET | `/admin/update` | `platform.system.manage` | Update status: `enabled` (stamped release build), `auto`, `current`/`latest` tags, `available`, `state` (idle, checking, downloading, restarting, error), `last_checked`, `error`, `writable` |
| POST | `/admin/update/check` | `platform.system.manage` | Ask GitHub for the latest release now; `409` when this is not a release build |
| POST | `/admin/update/apply` | `platform.system.manage` | Start installing the newest release in the background and restart; returns at once with `state: downloading`; `409` when there is nothing newer or an install is running |
| DELETE | `/admin/tunnel` | `platform.system.manage` | Disconnect now (autostart preference unchanged) |
| GET | `/admin/backups?limit=20` | `platform.system.manage` | Newest backups: name, size, time |
| GET | `/push/key` | any signed-in user | The server's VAPID public key (base64url); `""` when Web Push is not configured |
| POST | `/push/subscriptions` | any signed-in user | A browser `PushSubscription` (`{endpoint, keys: {p256dh, auth}}`). The endpoint must be https on port 443 at a known push service (Google, Mozilla, Apple, Windows), never an IP address; `422` for a bad subscription, `404` when push is off. A browser registered by someone else moves to the caller |
| DELETE | `/push/subscriptions?endpoint=` | any signed-in user | Remove the caller's own subscription (idempotent; the page does it before signing out) |
| GET | `/notifications?limit=30` | any signed-in user | The caller's own notifications, newest first, with the unread count across all |
| POST | `/notifications/{id}/read` | any signed-in user | Mark one of the caller's notifications read (someone else's id changes nothing); answers with the refreshed list |
| POST | `/notifications/test` | signed in | Sends the caller a test notification (bell and, where this device subscribed, Web Push), once a minute at most: `{push_configured, devices}`. For checking that a phone receives messages with the app closed |
| POST | `/notifications/read-all` | any signed-in user | Mark all of the caller's notifications read; answers with the refreshed list |
| GET | `/admin/system/health` | `platform.system.manage` | Integrity check result, journal mode, database size, backup count and time, schedule |
| GET | `/admin/system/metrics` | `platform.system.manage` | Technical health for the «Стан програми» page: build (release tag, or for a build without a tag the git revision the compiler recorded and whether the tree was modified; Go and SQLite engine and driver versions) and uptime, runtime, database (file/WAL size, pages, free pages, row counts of the main tables), disk, backups (`last_run_at`/`last_error`/`run_overdue`: the job's own record, because a copy is skipped when nothing changed), background jobs, push (subscriptions, backlog, browsers reached / failed / cancelled since start, last failure), live sessions, HTTP counters since start (`client_errors` = 4xx refusals, `server_errors` = 5xx faults). The integrity verdict is cached for 10 minutes, so the page can poll |
| POST | `/admin/system/integrity-check` | `platform.system.manage` | Runs `quick_check` now: `{verdict, ok, checked_at}` |
| GET | `/admin/system/logs` | `platform.system.manage` | Recent warnings and errors of the program's own log (`level=error` or `warning`, `limit` up to 300): `{entries: [{at, level, message, count}], errors_24h, warnings_24h, persisted}`. Identical consecutive lines are merged (`count`), URLs are reduced to their host. Entries are also kept in `<data>/logs/legkyi.log` (0600, about 1 MB, one rotation) and reloaded at start. Every 500 response is logged as `server error: METHOD /path: cause` (no query string) and its cause is `last_server_error.message` in the metrics; a panic in a handler becomes a logged 500. Level comes from the words of the message («failed», «error», «warning»): a heuristic, because the standard log has no levels |
| GET | `/admin/backups/{name}/download` | `platform.system.manage` | Download one listed copy (`404` for a name that is not in the list) |
| GET | `/admin/backup/download` | `platform.system.manage` | Take a fresh verified snapshot and download it (`500` if it cannot be made; the live file is never streamed) |

## Reports module endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/store/reports/{period}` | `reports.submit` (organisation member) | The caller's organisation report and editable lines |
| PUT | `/store/reports/{period}` | `reports.submit` (organisation member) | Save a report snapshot as a draft or submit it; a submit records the submitting employee. Report responses (store page, `/admin/reports`, `/admin/reports/{id}`) carry `submission` and `locked` (`{by, signed_at}`) when known (see docs/modules/reports.md) |
| GET | `/admin/reports?period=YYYY-MM` | `reports.review` | Reports of all visible organisations for a month, including missing submissions |
| GET | `/admin/reports/{id}` | `reports.review` | Report detail |
| PATCH | `/admin/reports/{id}` | `reports.review` | Lock/unlock by setting status |
| GET | `/admin/summary?period=YYYY-MM&submitted_only=false` | `reports.review` | Summary DTO and totals |
| GET | `/admin/summary.xlsx?period=YYYY-MM&submitted_only=false` | `reports.review` | Summary as an Excel workbook |
| GET | `/admin/products?period=YYYY-MM` | `reports.catalog.manage` | Product DTOs, usage counts, the current-month price timeline, and full price history |
| POST | `/admin/products` | `reports.catalog.manage` | Create product |
| POST | `/admin/products/import` | `reports.catalog.manage` | Bounded `.xlsx` import (multipart) with a message DTO |
| PUT | `/admin/products/{id}`, `/admin/products/{id}/price` | `reports.catalog.manage` | Update name/active state; change price |
| DELETE | `/admin/products/{id}` | `reports.catalog.manage` | Archive products with report history; otherwise delete |
| POST | `/admin/products/{id}/restore` | `reports.catalog.manage` | Restore an archived product |
| GET | `/reports/settings` | `reports.settings.manage` | Per-organisation report options and report counts |
| PUT | `/reports/settings/{organisation_id}` | `reports.settings.manage` | Turn the «По розрахунку» calculation quantity on or off |

## Transport module endpoints (scaffold)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/transport/status` | any transport permission | `{ready, message}` |
| GET | `/transport/orders` | create, view_all or manage | The day's orders (`date`, default today) or a range (`from`, `to`), chronological; `status`; staff may add `organisation_id`. A desk sees only its organisation |
| GET | `/transport/days` | same | Order counts per day for the date strip (`date`, or `from` and `to`, same scoping as the list; only days with orders): `{date, total, open, attention, military_open, by_status}`. `open` = submitted, accepted, in_progress, bumped; `attention` = submitted for a dispatcher, bumped for a desk; `military_open` = open military orders |
| GET | `/transport/orders/{id}` | same | One order; `events` (history) only for staff |
| POST | `/transport/orders` | `transport.orders.create` (organisation member) | `{service_date, deceased, notes?, military?: bool, delivery?: {car_number, departure, time, destination, stops?}, carriers?: {car_number, departure, count: 4 or 6, time, stops (at least one), cemetery_number}}`; at least one part; signed with the submitting employee. `409` when a car is busy (2 h lock; see docs/modules/transport.md); `military: true` takes the car from an ordinary order, which becomes `bumped` |
| PUT | `/transport/orders/{id}` | `transport.orders.create` | Replace the content while the status is `submitted` or `bumped` (`409` after the reply, or when the car is busy; a bumped order goes back to `submitted`) |
| POST | `/transport/orders/{id}/cancel` | `transport.orders.create` | Cancel while `submitted` or `bumped` |
| POST | `/transport/orders/{id}/status` | `transport.orders.manage` | `{status: accepted, in_progress, done or rejected; note?}`; `409` for a transition that is not allowed, `422` when rejecting without a note |
| PUT | `/transport/orders/{id}/bearers` | `transport.orders.manage` | `{names: [..]}`: the men assigned to the carriers part (at most the ordered crew of 4 or 6); `409` without carriers or for a rejected/cancelled order

## Example requests

Create a product:

```http
POST /api/v1/admin/products
Content-Type: application/json

{"name":"Хліб","price":"25.50"}
```

Update a product:

```http
PUT /api/v1/admin/products/12
Content-Type: application/json

{"name":"Хліб","price":"26,00","active":true}
```

Repeat the same update endpoint when the price changes again during the same month. Each distinct change is appended to the history using period keys `YYYY-MM`, `YYYY-MM_1`, `YYYY-MM_2`, and so on; previous values are not overwritten. A no-op (the price is already current) is ignored. Returning to an earlier amount is still recorded as a history event.

The admin UI timeline shows each event, including repeated amounts. Report DTOs deliberately offer one input per **unique price amount**, because quantities are stored by product and unit price. For example, price changes `10.00 → 12.00 → 15.00 → 12.00` keep all four events in history but offer the report price choices `10.00, 12.00, 15.00`. Previously saved report quantities are not recalculated.

Save the full set of editable report quantities. The server revalidates every product/price pair against its own history, preserves quantities for inactive or archived products, and blocks further edits after submission. Each line may also include an independent `quantity_calc` integer for an organisation where `calculation_enabled` is on (`/reports/settings`). That quantity is visible separately in the store report, combined report, and combined XLSX export; it never contributes to monetary totals. Older clients may omit `quantity_calc`, in which case an existing calculation quantity is preserved:

```http
PUT /api/v1/store/reports/2026-10
Content-Type: application/json

{"action":"draft","quantities":[{"product_id":12,"price_cents":2600,"quantity":4}]}
```

## Client rendering

The browser UI is a React single-page application built with Vite and TypeScript. Route-level pages use TanStack Query for loading, caching, and mutations. The report module owns feature API functions and localization; the shared platform API client handles same-origin cookies and structured errors. FastAPI serves the compiled SPA from `backend/app/static/app/` and keeps the minimal Jinja templates for offline/error fallback and legacy route compatibility. Excel downloads remain server-generated binary responses.


## Local development and runtime secrets

From the repository root, install the locked dependencies, then launch from the backend package root:

```bash
uv sync
cd backend
uv run --project .. python -m app
```

Open `http://127.0.0.1:8000`. Stop the server with Ctrl+C. The first run initializes the SQLite database, backups, and `secret.key`; the initial administrator password is printed to the terminal.

`secret.key` is a randomly generated application secret used by Starlette's session middleware to sign session cookies. Keep it private, exclude it from source control, and back it up alongside `reports.db`. Losing or changing it invalidates existing signed sessions, so users must sign in again; it does not reset their stored passwords. You may set a stable secret using the `SECRET_KEY` environment variable instead.
