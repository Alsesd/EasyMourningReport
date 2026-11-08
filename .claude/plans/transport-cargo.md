# Transport v2: fleet, product requests, cargo (frozen contract)

Agent working material (not end-user docs). Decided 2026-11-07 by the orchestrator from the owner's request.
Supersedes the open questions of `product-orders.md` (variant A chosen: products are part of the transport slice).

## Owner's request (summary)

1. Transport module is a mess: duplicated fields, car numbers in arbitrary formats, an ugly interface.
2. Desks order products (coffin, baskets, cross...). The dispatcher (same person who handles transport orders) sees
   the requests, and either loads the goods onto a car that already goes to that desk that day (an existing transport
   order) or creates a goods-delivery run on some car with a route over several desks. Every carrying order/run shows a
   cargo manifest; only items that were actually ordered can be loaded.

## Decisions

- **Permissions: no new codes.** `transport.orders.create` (organisation): create/see own product requests, see the
  fleet list. `transport.orders.manage` (platform): everything below (fleet, runs, cargo, assignment, reject).
  `transport.orders.view_all` (platform): read-only everything. Update permission labels/descriptions to mention products.
- **Fleet registry** `transport_cars`; desks and dispatcher pick a car from it instead of typing. The text columns
  `delivery_car`/`carriers_car` stay as the stored snapshot (canonical display form), so old rows keep working.
- **Plate format.** Normalise: trim, uppercase, drop spaces/dashes/dots, map Latin lookalikes to Cyrillic
  (A→А B→В C→С E→Е H→Н I→І K→К M→М O→О P→Р T→Т X→Х). Standard plate: `^[АВЕІКМНОРСТХ]{2}\d{4}[АВЕІКМНОРСТХ]{2}$`,
  displayed `АА 1234 ВВ`. A car can be saved with `nonstandard: true` (military, transit, foreign): stored normalised,
  displayed as typed-normalised. The CarLock comparison uses the new normaliser for BOTH sides, and must still match
  old free-text rows (old normaliser = lowercase + strip whitespace; the new one is a superset: test it).
- **Backfill:** at start, insert-only into `transport_cars` the distinct car strings of existing orders that normalise to
  a standard plate (idempotent, `INSERT OR IGNORE` on the unique plate). Never update or delete order rows.
- **Duplicated fields:** one order = one deceased. The form asks for the car once ("Авто") at the top of the run part;
  the carriers part defaults to "той самий автомобіль" (same car, departure = delivery destination) and only shows its own
  car/departure when the toggle is off. API keeps `delivery` and `carriers` objects (backward compatible) but accepts
  `car_id` in each.
- **Desk car becomes optional** (the dispatcher assigns). Moving an order to `accepted` or `in_progress` requires a car
  on each present part (409 `car_required`). Contracts fixtures change on purpose for this: say so in the commit.
- **Dispatcher assignment:** dispatcher can change car, time and stops of any open order.
- **Product requests:** desks request catalogue products (catalogue comes from `reports` through a `core` interface;
  active, not archived). No prices in v2 (owner did not ask; can be added later). No per-desk assortment in v2 (all active
  products). Product search: client-side combobox per `product-orders.md` §5 (any word, prefix of any word, numbers exact,
  layout EN→UK fallback), one GET with ETag.
- **Cargo:** a line = (request item, quantity) placed either on a transport order (`order` carrier, destination = that
  order's organisation) or on a goods run stop (`run` carrier, destination = the stop's organisation). Server rejects a line
  whose item belongs to another organisation than the destination, or quantity > remaining (computed inside the write tx).
- **Request status** is derived, not typed: `submitted` (nothing loaded), `partial`, `planned` (all quantities loaded),
  `delivered` (every carrier of every line is `done`), `cancelled` (desk, only while nothing loaded), `rejected`
  (dispatcher, with note, only while nothing loaded). Stored column holds only submitted/cancelled/rejected; the rest is
  computed on read.
- **Goods runs** `transport_runs`: date, car (required), time, departure (free text, default «Склад»), notes, status
  `planned → in_progress → done`, `cancelled`. Stops: ordered list of (organisation_id, place text default = organisation
  name). CarLock covers runs too (same car within 2 h of another run or order the same day/neighbouring midnight).
- 15:00 cutoff: not enforced (unchanged).
- Notifications: new product request → `transport.orders.manage` holders. Cargo placed on an order/run, run status
  change, request rejected → the desk's `transport.orders.create` users of that organisation.

## Data model (Go-owned: `goOwned` + `GoOwnedTables` + `structure()` filter in store_test.go; NOT fresh.sql)

```
transport_cars(id PK, plate TEXT NOT NULL UNIQUE, nonstandard INT NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '',
               active INT NOT NULL DEFAULT 1, created_at INT NOT NULL)
goOwnedColumns: transport_orders.delivery_car_id INTEGER (NULL), transport_orders.carriers_car_id INTEGER (NULL)
product_requests(id PK, organisation_id INT NOT NULL REFERENCES organisations(id), need_date TEXT NOT NULL,
                 deceased TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
                 reply_note TEXT NOT NULL DEFAULT '', created_by_id INT, created_by_name TEXT NOT NULL DEFAULT '',
                 created_at INT NOT NULL, updated_at INT NOT NULL)          + index (organisation_id, need_date), (need_date)
product_request_items(id PK, request_id INT NOT NULL REFERENCES product_requests(id) ON DELETE CASCADE,
                      product_id INT NOT NULL, product_name TEXT NOT NULL, quantity INT NOT NULL CHECK(quantity>0))
transport_runs(id PK, service_date TEXT NOT NULL, car_id INT NOT NULL, car_plate TEXT NOT NULL, time TEXT NOT NULL,
               departure TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
               created_by_id INT, created_by_name TEXT NOT NULL DEFAULT '', created_at INT NOT NULL, updated_at INT NOT NULL)
transport_run_stops(id PK, run_id INT NOT NULL REFERENCES transport_runs(id) ON DELETE CASCADE, position INT NOT NULL,
                    organisation_id INT NOT NULL, place TEXT NOT NULL)
transport_cargo(id PK, item_id INT NOT NULL REFERENCES product_request_items(id) ON DELETE CASCADE, quantity INT NOT NULL,
                order_id INT NULL REFERENCES transport_orders(id) ON DELETE CASCADE,
                run_stop_id INT NULL REFERENCES transport_run_stops(id) ON DELETE CASCADE,
                CHECK ((order_id IS NULL) != (run_stop_id IS NULL)))
```
Cargo on a cancelled/rejected order or cancelled run does not count as loaded (remaining comes back).

## API (all under /api/v1, JSON, existing error style `{"detail": ...}`; 422 with field errors via core.FormError)

Shared shapes:
```
Car        {id, plate, display, nonstandard, label, active}
CargoLine  {id, item_id, request_id, organisation_id, organisation_name, product_name, quantity}
Manifest   [{organisation_id, organisation_name, place, lines: CargoLine[]}]   // per destination, route order
```

Fleet
- `GET  /transport/cars?all=1` (create|manage|view_all; `all=1` incl. inactive, manage only) → `{items: Car[]}`
- `POST /transport/cars` (manage) `{plate, nonstandard, label}` → Car; 422 `plate` invalid; 409 duplicate
- `PATCH /transport/cars/{id}` (manage) `{label?, active?}` → Car

Catalogue
- `GET /transport/catalog` (create|manage|view_all) → `{items: [{id, name}]}`, sorted by name, `ETag` + 304.

Product requests
- `GET  /transport/product-requests?date=YYYY-MM-DD&open=1` (desk: own org; manage/view_all: all). `open=1` = status in
  submitted/partial (any date ≤ date+120, for the dispatcher's "unplanned" panel).
- `POST /transport/product-requests` (create) `{need_date, deceased, notes, items:[{product_id, quantity}]}` → Request
- `PATCH /transport/product-requests/{id}` (create, own org, only while status=submitted) same body → Request
- `POST /transport/product-requests/{id}/cancel` (create, own org, nothing loaded) → Request
- `POST /transport/product-requests/{id}/reject` (manage) `{note}` → Request
```
Request {id, organisation_id, organisation_name, need_date, deceased, notes, status, reply_note,
         submitted_by_name, created_at, updated_at,
         items: [{id, product_id, product_name, quantity, loaded, remaining,
                  carriers: [{kind: "order"|"run", id, car_display, time, status, quantity}]}]}
```

Transport orders (existing endpoints keep their shapes, plus):
- Order JSON gains `kind:"deceased"`, `delivery.car_id`, `carriers.car_id`, `cargo: Manifest` (one entry, the order's org).
- Desk create/edit: `delivery.car_number` may be empty; `car_id` (from fleet) preferred; if both given, car_id wins.
- `PATCH /transport/orders/{id}/assignment` (manage, open orders) `{delivery?: {car_id, time, stops}, carriers?: {car_id,
  time, stops, same_car}}` → Order. CarLock applies.
- `PUT  /transport/orders/{id}/cargo` (manage) `{lines:[{item_id, quantity}]}` replaces this order's cargo → Order.
- Status change to accepted/in_progress without cars → 409 `{"detail": "...", "code": "car_required"}`.

Goods runs
- `GET  /transport/runs?date=` (manage|view_all; desk sees runs with a stop for its org, read-only) → `{items: Run[]}`
- `POST /transport/runs` (manage) `{service_date, car_id, time, departure, notes, stops:[{organisation_id, place,
  lines:[{item_id, quantity}]}]}` → Run
- `PATCH /transport/runs/{id}` (manage, while planned) same body → Run
- `POST /transport/runs/{id}/status` (manage) `{status, note}` → Run   (planned→in_progress|cancelled, in_progress→done|cancelled)
```
Run {id, kind:"goods", service_date, car: Car, time, departure, notes, status, created_by_name, created_at, updated_at,
     stops: [{id, position, organisation_id, organisation_name, place}], manifest: Manifest}
```

Day helpers
- `GET /transport/days` counts gain `requests_open` (open product requests needed that day) and `runs` per day.
- `GET /transport/board?date=` (manage|view_all) → `{orders: Order[], runs: Run[], open_requests: Request[],
  cars: Car[]}`: one call for the dispatcher board. Desks keep using the existing day endpoints.

## UI (frontend/src/modules/transport)

- Page tabs (segmented, URL `?tab=`): «Замовлення» (orders, as today), «Продукція» (desk: my requests + new request form;
  dispatcher: all requests of the day + unplanned panel), «Рейси» (dispatcher board: per-car lanes for the day with orders
  and runs, time-sorted; manifest per carrier), «Автопарк» (manage only: list, add, deactivate).
- Product request form: rows of (product combobox, quantity stepper), add/remove rows, need date (`ui/DayPicker`).
- Dispatcher actions on an open request: «Додати до рейсу» → dialog listing today's orders and runs that already go to
  that desk (car, time), pick one, choose quantities (≤ remaining) → PUT cargo / PATCH run. «Новий рейс» → run editor:
  car, time, departure, route stops (desk picker, place), per-stop lines picked only from that desk's open request items.
- Plate input: `PlateInput` in the module, formats as you type to `АА 1234 ВВ`, Latin lookalikes converted live, shows an
  error for non-standard unless «Нестандартний номер» is ticked. Car pickers are selects over the fleet with search.
- `ui/Combobox.tsx` (new generic primitive, ARIA combobox, 44 px rows, highlights matches) owned by the transport agent.

## Ownership (parallel agents in one working tree)

- A backend: `internal/**` (transport, core, reports catalogue hook, store schema + tests, registry), `testdata/**`,
  `cmd/**`, `docs/API.md` transport section.
- B transport UI: `frontend/src/modules/transport/**`, `frontend/src/ui/Combobox.tsx` (+test), transport parts of
  `frontend/src/platform/api/schema.d.ts`, transport parts of `scripts/e2e_test.py`.
- C platform UI: `frontend/src/ui/**` except Combobox, `frontend/src/platform/**` except schema.d.ts transport parts,
  `frontend/src/app/**`, `frontend/tailwind.config.js`, `frontend/src/modules/reports/**`, `frontend/src/modules/management/**`,
  login/dialog parts of `scripts/e2e_test.py`.
- D docs: `docs/**` (except API.md transport section until A is done), `.claude/memory/**`, `.claude/plans/**` moves,
  references in `CLAUDE.md`, `.claude/rules/**`, `.claude/skills/**`, `README.md`.

## Deviations / amendments (backend, recorded by agent A)

Owner amendments (override the decisions above):
- **Desk car stays required on orders.** Each present part needs a car: `car_id` from the fleet (wins), or a legacy
  `car_number` that names a fleet car or is a standard plate; missing/invalid → 422 at `delivery.car_number` /
  `carriers.car_number` (old behaviour). `car_required` (409, `{"detail", "code": "car_required"}`) stays only as a guard
  on accepted/in_progress (e.g. an order that lost its car). Contract fixtures were not changed for car handling.
- **Product requests have an optional car** (preference only, creates no cargo): `product_requests.car_id` (NULL) +
  `car_plate` snapshot; Request JSON `car: Car|null`; POST/PATCH body `car_id: number|null`.
- **Prices:** `product_request_items.unit_price_cents` (NULL) = the product's latest actual price (reports
  `LatestPrice(HistoryOf(...))`, through `core.Module.Catalog`; 0 counts as no price), snapshotted when the item is created
  or edited. Catalogue item `{id, name, price_cents|null}`; item JSON `unit_price_cents`, `total_cents` (null without a
  price); Request `total_cents`; CargoLine `unit_price_cents`, `total_cents` (from the item snapshot). Integer cents.
- **No 15:00 cutoff** anywhere.
- `GET /transport/product-requests` returns `{items: Request[]}` (not a bare array).
- Same-car on create/update: the client may send `carriers.car_id` + `car_number` + `departure` explicitly; `same_car`
  is accepted but optional (create and `/assignment`).
- DEMO seed adds fleet cars (АА 1234 ВВ, ВС 5678 АА, КА 0101 КК, nonstandard ЗСУ1234) and links demo orders; the
  reports demo products already carry prices.

Backend choices where the contract was silent or could not be followed literally:
- Desk's `GET /transport/runs`: only the desk's own stops and manifest entries are returned (other desks' cargo and
  route points are hidden).
- A military order never takes a goods run's car (runs have no `bumped` state): 409.
- `POST /transport/runs/{id}/status` `note` is not stored (runs have no reply column); it goes into the desks'
  notification only.
- `carriers.departure` on orders defaults to the delivery's destination when omitted.
- A run needs at least one stop (422). Run stop ids change on every `PATCH /runs/{id}` (stops and cargo are replaced).
- `/assignment` on a `bumped` order that gets a car moves it back to `submitted` (otherwise it could only be rejected).
  Fields absent (or `car_id: null`) keep their value; clearing a car is not supported. History kind `assignment`.
- Cargo replace (`PUT /orders/{id}/cargo`, `PATCH /runs/{id}`) deletes the carrier's lines first in the same write
  transaction, so remaining never counts them twice. Duplicate `item_id`s in one carrier are merged.
- `delivered` requires everything loaded and every carrier `done`; partly loaded with done carriers stays `partial`.
- Order manifest entry `place` = the organisation name. Item carrier `car_display`/`time` for an order = the delivery
  part's car (else the carriers part's) and the order's earliest time.
- Typed car text that names an active fleet car is linked to it (`car_id`, canonical display).
- New Module hooks: `core.Module.Catalog` (reports) → `core.Services.Catalog`; `core.Module.Startup` (insert-only
  backfills, run by `cmd/server` after the seed). `core.HTTPError` gained optional `Code`.
- Backfill: only plates that normalise to a standard plate are inserted; a car a dispatcher deactivated stays so.
- OrganisationUsage now also counts product requests and run stops (an organisation with them is archived, not deleted).
- Fixed on the side: `POST /organisations` with `first_user` used a `store` role a fresh database does not have;
  `platform.EnsureStoreRole` creates it with the default grants.
