# Transport module

**Backend:** `internal/transport/` · **Frontend:** `frontend/src/modules/transport/`

Order desks (organisation employees) order transport for the deceased and request products (coffins, baskets, crosses: the reports catalogue); dispatchers (platform staff) see every desk's orders and requests, reply with a status, assign cars from the fleet, load the requested goods onto a car that already goes to the desk or onto a goods run with a route over several desks.

| File | Owns |
|---|---|
| `module.go` | `core.Module`: permissions, audit actions, usage, demo seed, `Startup` (fleet backfill) |
| `orders.go`, `booking.go`, `http.go` | Orders for the deceased, the 2-hour car lock, military bumping, statuses, bearers |
| `fleet.go`, `http_fleet.go` | Fleet registry and plate normalisation |
| `requests.go`, `http_requests.go` | Product requests and the catalogue endpoint (products and prices come from `reports` through `core.Services.Catalog`) |
| `cargo.go`, `http_assign.go` | Cargo lines, remaining quantities, dispatcher assignment (car, time, stops), cargo on orders |
| `runs.go`, `http_runs.go` | Goods runs, their stops, manifests and statuses, the day board |
| `reminder.go`, `dashboard.go` | The 14:30 reminder; blocks for the management dashboard |

The page has four tabs (URL `?tab=`), each shown only to whom it applies: «Замовлення» (everyone with a transport permission), «Продукція» (same), «Рейси» (the dispatcher's day board: `manage`, `view_all`), «Автопарк» (`manage`).

## What an order is

One order per deceased, with two optional parts (at least one is required). Delivery and carriers of the same deceased live in the same order, so they are always listed together.

| Level | Fields (all required unless marked) |
|---|---|
| Order | service day (`YYYY-MM-DD`), deceased, note (optional), organisation, **submitting employee** (id and a name snapshot: full name, else login) |
| Delivery (optional part) | **car from the fleet**, departure place, time, final destination, transit stops (optional) |
| Carriers («винос»: bearers; optional part) | **car from the fleet** («Той самий автомобіль» by default: the delivery's car, leaving from the delivery's destination; untick it to pick another car and departure place), crew size (**4 or 6**), time, **transit stops (at least one: e.g. the house of mourning, the church)**, **cemetery number**; the **dispatcher assigns the bearers by name** (at most the crew size) |

**The car is required on every present part** and is picked from the fleet (`car_id`). An old client may still send a typed `car_number`; it is accepted only when it names a fleet car or is a standard plate (otherwise `422` at `delivery.car_number` / `carriers.car_number`). The text columns `delivery_car` / `carriers_car` keep the canonical display form as a snapshot, so old rows keep working. A dispatcher may change the car, time and stops of any open order («Змінити авто й час», `PATCH /orders/{id}/assignment`; a bumped order that gets a car goes back to `submitted`). Moving an order to accepted or in progress while a present part has no car is refused (`409`, code `car_required`).

One car may do both parts, or one car delivers while another carries the coffin. When it is the same car (`same_car` in the API) both parts are one run: they are in the same row of the day list, so nothing lands between a car's delivery and its carrying.

At least one of delivery and carriers is required. The route has to be in the order: the stops and the cemetery of a carrying order are mandatory, so a stop that is made but was not ordered is the desk's omission and visible in the history.

The day list is ordered by the earliest time of each order (then by id). Times are 24-hour `HH:MM`.

## Permissions

| Permission | Scope | Use |
|---|---|---|
| `transport.orders.create` | organisation | «Замовлення транспорту й продукції»: create orders and product requests for your organisation, edit or cancel them while nothing has happened yet, see their status, the dispatcher's reply, the runs that carry your products (your own stops only) and the list of cars. Only your own organisation's records are visible (others answer 404). |
| `transport.orders.manage` | platform | «Обробка замовлень транспорту й продукції»: see everything of every organisation, set statuses, assign cars, load products onto orders and runs, create runs, reject requests, keep the fleet. |
| `transport.orders.view_all` | platform | «Перегляд усіх…»: read-only everything, including the day board, runs, cargo and the fleet list. |

A role is a plain set of permissions and the user's division is the scope of what they see: nobody sees other divisions' orders unless a role they hold grants `manage` or `view_all`. A dispatcher may belong to a division or to none, and one person may hold both `create` and `manage`. The built-in desk role «Підрозділ» (`store`) does not get `create` by default; make or edit a role for the desks in the role editor (the demo role gets it). There are no separate permission codes for products, runs or the fleet.

## Bearers and the printed schedule

The desk orders a crew of 4 or 6. A dispatcher (`manage`) names the men for each carrying order (`PUT /orders/{id}/bearers`, not for rejected or cancelled orders; a desk edit keeps the names but cuts them to a smaller crew). «Схема виносу» on the day view opens a page for printing: carrying orders only, earliest carrying time first, with deceased, organisation, departure place and stops, cemetery, and who carries (a missing crew is flagged). The menu and sidebar are hidden when printing.

## Car occupancy and military orders

A car (its number, compared without case and spaces) is **locked for 2 hours** (`transport.CarLock`) around every part of an active order (`submitted`, `accepted`, `in_progress`): another order that puts the same car on the road less than 2 hours before or after it is refused with `409` and a message naming the busy window (`10:00–12:00`; exactly 2 hours apart is free). The lock crosses midnight. Goods runs hold their car the same way (orders and runs are checked together); a military order never takes a run's car (`409`). Plates are compared after normalisation (see Fleet), which also matches old free-text rows. Both parts of an order count; the delivery and carrying of one order never clash with each other, and an edit never clashes with the order's own old content. `done`, `rejected`, `cancelled` and `bumped` orders hold no car. The check runs in the same transaction as the write (one writer), on create and on every edit.

**Military order** (`military: true`, the «Військове замовлення» switch in the form; shown with a badge): it has priority. If the car is taken by an ordinary order, that order is **bumped**: its status becomes `bumped` («Авто знято»), the reply note says why, the history gets a `bumped` event and the audit log «знято авто із замовлення транспорту». The desk keeps the order, can edit it (another car or time: it goes back to `submitted`) or cancel it. A military order is refused (`409`, nothing is bumped) when the car is already taken by **another military order** or the order on it is **`in_progress`** (the car is out). The flag is stored with the order, audited («· військове») and visible to everyone who sees the order. Any desk with `create` may set it.

## Statuses

`submitted` (Надіслано) → `accepted` (Прийнято, action «Прийняти») → `in_progress` (В дорозі, action «Виїхали») → `done` (Виконано). A dispatcher may also set `rejected` (Відхилено, a reason is required) from any open status, including `bumped`. `bumped` (Авто знято) is set only by a military order; the desk may edit or cancel it. A desk may `cancel` (Скасовано) only while the order is `submitted` or `bumped`; once the dispatcher has replied, the desk can neither edit nor cancel. `done`, `rejected` and `cancelled` are final. Every change is stored in the order's history (who, when, status, note) and in the audit log.

The list refreshes every 15 seconds and shows the status and the reply note. On top of that, the bell (see `docs/architecture.md`, Notifications) tells people:

| Event | Who is told |
|---|---|
| New order; order sent again after being bumped; a desk cancels | dispatchers (`manage`), except the person who did it |
| Dispatcher sets accepted / in progress / done / rejected | the employee who submitted the order |
| Car taken by a military order (`bumped`) | the employee who submitted the bumped order |
| New product request; a desk cancels a request | dispatchers (`manage`) |
| Products loaded onto an order («Продукцію додано до замовлення транспорту»), planned into a run («Продукцію заплановано в рейс»), a run with the desk's products changed, a run's status changes («Рейс з продукцією: …», the dispatcher's note is only in this message), a request rejected | employees of that organisation with `create` |
| 14:30 (`REMINDER_AT`, in `APP_TIMEZONE`): the organisation has no order for tomorrow that holds or has done a car (cancelled, rejected and bumped ones do not count) | every employee of that organisation with `create`; once per person and day |

The 14:30 time is only a default for the reminder (`REMINDER_AT`). There is no cutoff for orders: the server accepts an order for any day at any time.

## Fleet and plates

The fleet (`transport_cars`, tab «Автопарк», `manage`) is the list of cars that desks and dispatchers pick from. A car has a plate, an optional note (make, driver), a «нестандартний номер» flag and an active flag («Вивести з роботи» / «Повернути в роботу»: an inactive car disappears from the pickers, old orders keep it). Plates are normalised: trimmed, upper case, spaces, dashes and dots dropped, Latin lookalikes (A B C E H I K M O P T X) turned into Cyrillic. A standard plate is two letters, four digits, two letters (`АА1234ВВ`) and is displayed `АА 1234 ВВ`; the input formats it as you type. Anything else (military, transit, foreign) needs «Нестандартний номер» and 3 to 20 characters. Duplicates are refused (`409`). At start-up `Startup` inserts (insert-only, idempotent) the distinct car strings of existing orders that normalise to a standard plate; a car a dispatcher deactivated stays inactive.

## Product requests

A desk (`create`) requests products for a need date (tab «Продукція», «Нова заявка»): rows of a product (searchable combobox over the active, not archived catalogue: any word, a prefix of any word, numbers exact, a Latin keyboard layout falls back to Ukrainian) and a quantity, optional «Для кого» (deceased), note and **«Бажане авто»** (optional: a preference for the dispatcher, it creates no cargo). Each item **snapshots the product's latest actual price** from the catalogue (`unit_price_cents`, null when the product has no price) when it is created or edited; the request shows line sums and «Разом». The same product twice becomes one line.

The desk may edit a request while nothing is loaded (`submitted`) and cancel it while nothing is loaded. A dispatcher may reject it with a required reason while nothing is loaded.

**Status is derived, not typed:** `submitted` («Надіслано», nothing loaded), `partial` («Частково завантажено»), `planned` («Заплановано», all quantities loaded), `delivered` («Доставлено»: all loaded and every carrier `done`), `cancelled`, `rejected`. Only submitted / cancelled / rejected are stored. Cargo on a cancelled or rejected order or a cancelled run does not count as loaded, so the quantity becomes free again.

## Cargo and goods runs

A cargo line is (request item, quantity) placed either on a **transport order** (the destination is the order's organisation) or on a **goods run stop** (the destination is the stop's organisation). The server refuses a line whose item belongs to another organisation than the destination (`422`), a request that is cancelled or rejected (`409`), and a quantity above what is still not loaded (`422`; computed inside the write transaction, the carrier's own earlier lines excluded). Replacing a carrier's cargo deletes its old lines first in the same transaction.

Dispatcher flows:

- **«Додати до рейсу»** on an open request: a dialog lists the orders and runs of that day that already go to the desk (car, time), the dispatcher picks one and enters quantities (at most what remains). For an order this is `PUT /orders/{id}/cargo`, for a run `PATCH /runs/{id}`. If nothing goes there that day, «Створити рейс».
- **«Новий рейс»**: car (required), time, departure (default «Склад»), note, and a route of stops (a desk and a place, default the desk's name; reorder up and down). Each stop's lines are picked only from that desk's open request items. At least one stop. A run is editable while `planned`; its status goes planned → in progress («Виїхали») → done («Виконано»), or cancelled («Скасувати рейс») from planned or in progress.

Every order and run that carries goods shows its **manifest** («Вантаж»): per destination, in route order, product, quantity and the snapshotted price and sum. A desk sees only its own stops and manifest lines of a run.

The **«Рейси» tab** (`GET /board`) shows the day per car, in time order: orders and runs in lanes, a lane «Авто не призначено», «Вільні авто», and the panel «Незаплановані заявки» (open requests needed up to 120 days ahead, older first). The date strip also counts open product requests and runs per day.

## API

All under `/api/v1/transport`; see `docs/API.md`. `GET /orders` takes `date` (default today) or `from`/`to` (at most 400 days), plus `status` and, for staff, `organisation_id`.

## Data

Go-owned tables (`internal/store/schema.go`, `goOwned`): `transport_orders` (plus `delivery_car_id` / `carriers_car_id`), `transport_order_stops` (ordered, per part), `transport_order_events` (the history), `transport_cars`, `product_requests` (with an optional `car_id` and `car_plate` snapshot), `product_request_items` (with `unit_price_cents`), `transport_runs`, `transport_run_stops` and `transport_cargo`. An organisation that has orders, product requests or run stops is archived instead of deleted.

## Demo

`DEMO=1` seeds the fleet (АА 1234 ВВ «Катафалк Mercedes», ВС 5678 АА «Катафалк Ford», КА 0101 КК «Вантажний Renault», nonstandard ЗСУ1234 «Військовий (демо)»), two orders for today linked to those cars (one with both parts) for the demo divisions, and lets the demo desk role place orders and requests. The catalogue is the reports module's demo products, which carry prices.
