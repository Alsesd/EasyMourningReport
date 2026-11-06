# Transport module

**Backend:** `internal/transport/` (domain, SQL) and `internal/web/transport.go` (HTTP) · **Frontend:** `frontend/src/modules/transport/`

Order desks (organisation employees) fill in the day's table of transport orders; dispatchers (platform staff) see every desk's orders in one chronological list, reply with a status and read the history.

## What an order is

One order per deceased, with two optional parts (at least one is required). Delivery and carriers of the same deceased live in the same order, so they are always listed together.

| Level | Fields (all required unless marked) |
|---|---|
| Order | service day (`YYYY-MM-DD`), deceased, note (optional), organisation, **submitting employee** (id and a name snapshot: full name, else login) |
| Delivery (optional part) | **car number, departure place**, time, final destination, transit stops (optional) |
| Carriers («винос»: bearers; optional part) | **car number, departure place** (the delivery's car and place, or another car: the form starts with the delivery's values), crew size (**4 or 6**), time, **transit stops (at least one: e.g. the house of mourning, the church)**, **cemetery number**; the **dispatcher assigns the bearers by name** (at most the crew size) |

One car may do both parts, or one car delivers while another carries the coffin. When it is the same car (`same_car` in the API) both parts are one run: they are in the same row of the day list, so nothing lands between a car's delivery and its carrying.

At least one of delivery and carriers is required. The route has to be in the order: the stops and the cemetery of a carrying order are mandatory, so a stop that is made but was not ordered is the desk's omission and visible in the history.

The day list is ordered by the earliest time of each order (then by id). Times are 24-hour `HH:MM`.

## Permissions

| Permission | Scope | Use |
|---|---|---|
| `transport.orders.create` | organisation | Create orders for your organisation, edit or cancel them while they are still *Надіслано*, and see their status and the dispatcher's reply. Only your own organisation's orders are visible (others answer 404). |
| `transport.orders.manage` | platform | Handle orders: see every organisation's orders and the history, and set the reply status (with a note shown to the desk). Required to change a status. |
| `transport.orders.view_all` | platform | Read-only: see every organisation's orders and the history, no status changes. |

A desk and a dispatcher are different kinds of users: organisation roles can only hold organisation-scope permissions, platform roles only platform-scope ones. No role grants `create` by default; assign it to the desks' role in the role editor.

## Bearers and the printed schedule

The desk orders a crew of 4 or 6. A dispatcher (`manage`) names the men for each carrying order (`PUT /orders/{id}/bearers`, not for rejected or cancelled orders; a desk edit keeps the names but cuts them to a smaller crew). «Схема виносу» on the day view opens a page for printing: carrying orders only, earliest carrying time first, with deceased, organisation, departure place and stops, cemetery, and who carries (a missing crew is flagged). The menu and sidebar are hidden when printing.

## Statuses

`submitted` (Надіслано) → `accepted` (Прийнято) → `in_progress` (Виконується) → `done` (Виконано). A dispatcher may also set `rejected` (Відхилено, a reason is required) from any open status. A desk may `cancel` (Скасовано) only while the order is `submitted`; once the dispatcher has replied, the desk can neither edit nor cancel. `done`, `rejected` and `cancelled` are final. Every change is stored in the order's history (who, when, status, note) and in the audit log.

The desks' "notification" is the page itself: the list refreshes every 15 seconds and shows the status and the reply note.

## API

All under `/api/v1/transport`; see `docs/API.md`. `GET /orders` takes `date` (default today) or `from`/`to` (at most 400 days), plus `status` and, for staff, `organisation_id`.

## Data

Go-owned tables (`internal/store/schema.go`, `goOwned`): `transport_orders`, `transport_order_stops` (ordered, per part) and `transport_order_events` (the history). An organisation that has orders is archived instead of deleted.

## Demo

`DEMO=1` seeds two orders (one with both parts) for the demo shops and lets the demo `store` role place orders.
