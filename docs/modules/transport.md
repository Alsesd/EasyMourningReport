# Transport module

**Backend:** `internal/transport/` (domain, SQL, HTTP handlers in `http.go`) · **Frontend:** `frontend/src/modules/transport/`

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

A role is a plain set of permissions and the user's division is the scope of what they see: nobody sees other divisions' orders unless a role they hold grants `manage` or `view_all`. A dispatcher may belong to a division or to none, and one person may hold both `create` and `manage`. No role grants `create` by default; make a role for the desks in the role editor.

## Bearers and the printed schedule

The desk orders a crew of 4 or 6. A dispatcher (`manage`) names the men for each carrying order (`PUT /orders/{id}/bearers`, not for rejected or cancelled orders; a desk edit keeps the names but cuts them to a smaller crew). «Схема виносу» on the day view opens a page for printing: carrying orders only, earliest carrying time first, with deceased, organisation, departure place and stops, cemetery, and who carries (a missing crew is flagged). The menu and sidebar are hidden when printing.

## Car occupancy and military orders

A car (its number, compared without case and spaces) is **locked for 2 hours** (`transport.CarLock`) around every part of an active order (`submitted`, `accepted`, `in_progress`): another order that puts the same car on the road less than 2 hours before or after it is refused with `409` and a message naming the busy window (`10:00–12:00`; exactly 2 hours apart is free). The lock crosses midnight. Both parts of an order count; the delivery and carrying of one order never clash with each other, and an edit never clashes with the order's own old content. `done`, `rejected`, `cancelled` and `bumped` orders hold no car. The check runs in the same transaction as the write (one writer), on create and on every edit.

**Military order** (`military: true`, the «Військове замовлення» switch in the form; shown with a badge): it has priority. If the car is taken by an ordinary order, that order is **bumped**: its status becomes `bumped` («Авто знято»), the reply note says why, the history gets a `bumped` event and the audit log «знято авто із замовлення транспорту». The desk keeps the order, can edit it (another car or time: it goes back to `submitted`) or cancel it. A military order is refused (`409`, nothing is bumped) when the car is already taken by **another military order** or the order on it is **`in_progress`** (the car is out). The flag is stored with the order, audited («· військове») and visible to everyone who sees the order. Any desk with `create` may set it.

## Statuses

`submitted` (Надіслано) → `accepted` (Прийнято) → `in_progress` (Виконується) → `done` (Виконано). A dispatcher may also set `rejected` (Відхилено, a reason is required) from any open status, including `bumped`. `bumped` (Авто знято) is set only by a military order; the desk may edit or cancel it. A desk may `cancel` (Скасовано) only while the order is `submitted` or `bumped`; once the dispatcher has replied, the desk can neither edit nor cancel. `done`, `rejected` and `cancelled` are final. Every change is stored in the order's history (who, when, status, note) and in the audit log.

The list refreshes every 15 seconds and shows the status and the reply note. On top of that, the bell (see `docs/architecture.md`, Notifications) tells people:

| Event | Who is told |
|---|---|
| New order; order sent again after being bumped; a desk cancels | dispatchers (`manage`), except the person who did it |
| Dispatcher sets accepted / in progress / done / rejected | the employee who submitted the order |
| Car taken by a military order (`bumped`) | the employee who submitted the bumped order |
| 14:30 (`REMINDER_AT`, in `APP_TIMEZONE`): the organisation has no order for tomorrow that holds or has done a car (cancelled, rejected and bumped ones do not count) | every employee of that organisation with `create`; once per person and day |

Why 14:30: desks must place the next day's order by **15:00**; the reminder gives them half an hour. The cutoff itself is not enforced by the server (a later order is still accepted).

## API

All under `/api/v1/transport`; see `docs/API.md`. `GET /orders` takes `date` (default today) or `from`/`to` (at most 400 days), plus `status` and, for staff, `organisation_id`.

## Data

Go-owned tables (`internal/store/schema.go`, `goOwned`): `transport_orders`, `transport_order_stops` (ordered, per part) and `transport_order_events` (the history). An organisation that has orders is archived instead of deleted.

## Demo

`DEMO=1` seeds two orders (one with both parts) for the demo shops and lets the demo `store` role place orders.
