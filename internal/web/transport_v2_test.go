package web

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Transport v2: fleet, catalogue, product requests, cargo, goods runs, assignment.

type v2 struct {
	*desks
	coffin, cross, basket int64 // catalogue products (coffin 1500.00, cross 300.00, basket has no price)
}

func newV2(t *testing.T) *v2 {
	d := newDesks(t)
	v := &v2{desks: d}
	add := func(name string, cents int64, withHistory bool) int64 {
		res, err := d.e.st.W.Exec("INSERT INTO products (name, price_cents, active, archived) VALUES (?, ?, 1, 0)", name, cents)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		if withHistory {
			if _, err := d.e.st.W.Exec("INSERT INTO product_prices (product_id, period, price_cents) VALUES (?, '2025-01', ?)", id, cents-100); err != nil {
				t.Fatal(err)
			}
			if _, err := d.e.st.W.Exec("INSERT INTO product_prices (product_id, period, price_cents) VALUES (?, '2026-10', ?)", id, cents); err != nil {
				t.Fatal(err)
			}
		}
		return id
	}
	v.coffin = add("Труна дубова", 150000, true)
	v.cross = add("Хрест", 30000, false)
	v.basket = add("Кошик квітів", 0, false)
	if _, err := d.e.st.W.Exec("INSERT INTO products (name, price_cents, active, archived) VALUES ('Архівний товар', 100, 1, 1)"); err != nil {
		t.Fatal(err)
	}
	return v
}

func (v *v2) call(c *http.Cookie, method, path string, body any, want int) map[string]any {
	v.e.t.Helper()
	var w = v.e.do(method, path, "", nil, c)
	if body != nil {
		w = v.post(c, method, path, body)
	}
	if w.Code != want {
		v.e.t.Fatalf("%s %s: %d (want %d) %s", method, path, w.Code, want, w.Body)
	}
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return out
}

func (v *v2) car(plate string) int64 {
	return num(v.call(v.boss, "POST", "/api/v1/transport/cars", map[string]any{"plate": plate}, 200)["id"])
}

func (v *v2) request(c *http.Cookie, date string, items ...[2]int64) map[string]any {
	var list []map[string]any
	for _, it := range items {
		list = append(list, map[string]any{"product_id": it[0], "quantity": it[1]})
	}
	return v.call(c, "POST", "/api/v1/transport/product-requests", map[string]any{"need_date": date, "deceased": "Іваненко", "items": list}, 200)
}

func itemID(req map[string]any, i int) int64 {
	return num(req["items"].([]any)[i].(map[string]any)["id"])
}

func reqItem(req map[string]any, i int) map[string]any { return req["items"].([]any)[i].(map[string]any) }

func TestFleetCarsAreNormalisedValidatedAndManagedByTheDispatcherOnly(t *testing.T) {
	v := newV2(t)
	c := v.call(v.boss, "POST", "/api/v1/transport/cars", map[string]any{"plate": "aa-1234-bb", "label": "Катафалк"}, 200)
	if c["plate"] != "АА1234ВВ" || c["display"] != "АА 1234 ВВ" || c["nonstandard"] != false || c["active"] != true {
		t.Fatalf("%v", c)
	}
	v.call(v.boss, "POST", "/api/v1/transport/cars", map[string]any{"plate": "АА 1234 ВВ"}, 409)
	bad := v.call(v.boss, "POST", "/api/v1/transport/cars", map[string]any{"plate": "ЗСУ 1234"}, 422)
	if !strings.Contains(mustJSON(bad), `"plate"`) {
		t.Fatalf("the error must name the plate field: %v", bad)
	}
	ns := v.call(v.boss, "POST", "/api/v1/transport/cars", map[string]any{"plate": "зсу 1234", "nonstandard": true}, 200)
	if ns["display"] != "ЗСУ1234" || ns["nonstandard"] != true {
		t.Fatalf("%v", ns)
	}
	// Desks and the viewer may read the active fleet, not change it.
	v.call(v.a, "POST", "/api/v1/transport/cars", map[string]any{"plate": "КА 0101 КК"}, 403)
	v.call(v.view, "POST", "/api/v1/transport/cars", map[string]any{"plate": "КА 0101 КК"}, 403)
	v.call(v.boss, "PATCH", "/api/v1/transport/cars/"+itoa(int(num(ns["id"]))), map[string]any{"active": false}, 200)
	if n := len(v.call(v.a, "GET", "/api/v1/transport/cars?all=1", nil, 200)["items"].([]any)); n != 1 {
		t.Fatalf("a desk sees only active cars: %d", n)
	}
	if n := len(v.call(v.boss, "GET", "/api/v1/transport/cars?all=1", nil, 200)["items"].([]any)); n != 2 {
		t.Fatalf("all=1 for the dispatcher: %d", n)
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestCatalogueComesFromTheReportsModuleWithLatestPricesAndETag(t *testing.T) {
	v := newV2(t)
	w := v.e.do("GET", "/api/v1/transport/catalog", "", nil, v.a)
	if w.Code != 200 || w.Header().Get("ETag") == "" {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	var cat struct {
		Items []struct {
			ID         int64  `json:"id"`
			Name       string `json:"name"`
			PriceCents *int64 `json:"price_cents"`
		} `json:"items"`
	}
	json.Unmarshal(w.Body.Bytes(), &cat)
	var names []string
	for _, it := range cat.Items {
		names = append(names, it.Name)
		switch it.ID {
		case v.coffin:
			if it.PriceCents == nil || *it.PriceCents != 150000 {
				t.Fatalf("latest price of the history: %v", it.PriceCents)
			}
		case v.basket:
			if it.PriceCents != nil {
				t.Fatal("a product without a price has price_cents null")
			}
		}
	}
	if strings.Join(names, "|") != "Кошик квітів|Труна дубова|Хрест" {
		t.Fatalf("active products sorted by name, archived left out: %v", names)
	}
	w2 := v.e.do("GET", "/api/v1/transport/catalog", "", map[string]string{"If-None-Match": w.Header().Get("ETag")}, v.a)
	if w2.Code != 304 || w2.Body.Len() != 0 || w2.Header().Get("ETag") != w.Header().Get("ETag") {
		t.Fatalf("304 expected: %d %q", w2.Code, w2.Body)
	}
}

func TestProductRequestsArePricedScopedAndDerivedFromCargo(t *testing.T) {
	v := newV2(t)
	carID := v.car("АА 1234 ВВ")
	r := v.call(v.a, "POST", "/api/v1/transport/product-requests", map[string]any{"need_date": day, "car_id": carID,
		"items": []map[string]any{{"product_id": v.coffin, "quantity": 1}, {"product_id": v.cross, "quantity": 2}, {"product_id": v.basket, "quantity": 3}, {"product_id": v.cross, "quantity": 1}}}, 200)
	if r["status"] != "submitted" || r["organisation_name"] != "Філія А" || r["submitted_by_name"] != "Оксана Мельник" {
		t.Fatalf("%v", r)
	}
	if car, _ := r["car"].(map[string]any); car == nil || car["display"] != "АА 1234 ВВ" {
		t.Fatalf("the preferred car: %v", r["car"])
	}
	if len(r["items"].([]any)) != 3 || num(reqItem(r, 1)["quantity"]) != 3 {
		t.Fatalf("the same product twice is one line: %v", r["items"])
	}
	if num(reqItem(r, 0)["unit_price_cents"]) != 150000 || num(reqItem(r, 1)["total_cents"]) != 90000 || reqItem(r, 2)["unit_price_cents"] != nil || reqItem(r, 2)["total_cents"] != nil {
		t.Fatalf("price snapshot: %v", r["items"])
	}
	if num(r["total_cents"]) != 240000 {
		t.Fatalf("total: %v", r["total_cents"])
	}
	// The price is a snapshot: a later price change does not touch the stored request.
	v.e.st.W.Exec("UPDATE product_prices SET price_cents = 999 WHERE product_id = ?", v.coffin)
	list := v.call(v.a, "GET", "/api/v1/transport/product-requests?date="+day, nil, 200)["items"].([]any)
	if len(list) != 1 || num(list[0].(map[string]any)["total_cents"]) != 240000 {
		t.Fatalf("list: %v", list)
	}
	// Unknown or archived products are refused; another desk sees nothing and cannot touch it.
	v.call(v.a, "POST", "/api/v1/transport/product-requests", map[string]any{"need_date": day, "items": []map[string]any{{"product_id": 9999, "quantity": 1}}}, 422)
	v.call(v.a, "POST", "/api/v1/transport/product-requests", map[string]any{"need_date": day, "items": []map[string]any{}}, 422)
	if n := len(v.call(v.b, "GET", "/api/v1/transport/product-requests?date="+day, nil, 200)["items"].([]any)); n != 0 {
		t.Fatalf("another desk sees %d requests", n)
	}
	rid := itoa(int(num(r["id"])))
	v.call(v.b, "PATCH", "/api/v1/transport/product-requests/"+rid, map[string]any{"need_date": day, "items": []map[string]any{{"product_id": v.cross, "quantity": 1}}}, 404)
	v.call(v.b, "POST", "/api/v1/transport/product-requests/"+rid+"/cancel", map[string]any{}, 404)
	// The viewer and the dispatcher see it; only the dispatcher may reject; the viewer is read-only.
	if n := len(v.call(v.view, "GET", "/api/v1/transport/product-requests?date="+day, nil, 200)["items"].([]any)); n != 1 {
		t.Fatalf("viewer sees %d", n)
	}
	v.call(v.view, "POST", "/api/v1/transport/product-requests/"+rid+"/reject", map[string]any{"note": "ні"}, 403)
	v.call(v.view, "PUT", "/api/v1/transport/orders/1/cargo", map[string]any{"lines": []any{}}, 403)
	v.call(v.view, "POST", "/api/v1/transport/runs", map[string]any{}, 403)
	// Edit while nothing is loaded.
	ed := v.call(v.a, "PATCH", "/api/v1/transport/product-requests/"+rid, map[string]any{"need_date": day, "car_id": nil, "items": []map[string]any{{"product_id": v.cross, "quantity": 4}}}, 200)
	if ed["car"] != nil || len(ed["items"].([]any)) != 1 || num(ed["total_cents"]) != 120000 {
		t.Fatalf("edited: %v", ed)
	}
	v.call(v.boss, "POST", "/api/v1/transport/product-requests/"+rid+"/reject", map[string]any{"note": " "}, 422)
	rej := v.call(v.boss, "POST", "/api/v1/transport/product-requests/"+rid+"/reject", map[string]any{"note": "Немає на складі"}, 200)
	if rej["status"] != "rejected" || rej["reply_note"] != "Немає на складі" {
		t.Fatalf("%v", rej)
	}
	if n := count(v.e, "SELECT COUNT(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.login = 'desk_a' AND n.kind = 'transport.request.rejected'"); n != 1 {
		t.Fatalf("the desk is told about the rejection: %d", n)
	}
	if n := count(v.e, "SELECT COUNT(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.login = 'boss' AND n.kind = 'transport.request'"); n != 1 {
		t.Fatalf("dispatchers are told about a new request: %d", n)
	}
}

func TestCargoOnAnOrderIsLimitedToWhatTheDeskOrderedAndWhatIsLeft(t *testing.T) {
	v := newV2(t)
	o := v.create(v.a, order(day, "Петренко", "d09:00"))
	other := v.create(v.b, order(day, "Сидоренко", "d11:00"))
	r := v.request(v.a, day, [2]int64{v.coffin, 2}, [2]int64{v.cross, 1})
	rb := v.request(v.b, day, [2]int64{v.cross, 1})
	path := "/api/v1/transport/orders/" + itoa(int(o.ID)) + "/cargo"
	// Another organisation's item cannot ride to this desk.
	v.call(v.boss, "PUT", path, map[string]any{"lines": []map[string]any{{"item_id": itemID(rb, 0), "quantity": 1}}}, 422)
	v.call(v.boss, "PUT", "/api/v1/transport/orders/"+itoa(int(other.ID))+"/cargo", map[string]any{"lines": []map[string]any{{"item_id": itemID(r, 0), "quantity": 1}}}, 422)
	// More than ordered is refused.
	v.call(v.boss, "PUT", path, map[string]any{"lines": []map[string]any{{"item_id": itemID(r, 0), "quantity": 3}}}, 422)
	got := v.call(v.boss, "PUT", path, map[string]any{"lines": []map[string]any{{"item_id": itemID(r, 0), "quantity": 1}}}, 200)
	cargo := got["cargo"].([]any)
	if got["kind"] != "deceased" || len(cargo) != 1 {
		t.Fatalf("%v", got)
	}
	lines := cargo[0].(map[string]any)["lines"].([]any)
	if len(lines) != 1 || num(lines[0].(map[string]any)["total_cents"]) != 150000 || lines[0].(map[string]any)["product_name"] != "Труна дубова" {
		t.Fatalf("manifest: %v", cargo)
	}
	// Saving the same cargo again replaces it: it must not count its own lines twice.
	v.call(v.boss, "PUT", path, map[string]any{"lines": []map[string]any{{"item_id": itemID(r, 0), "quantity": 2}}}, 200)
	v.call(v.boss, "PUT", path, map[string]any{"lines": []map[string]any{{"item_id": itemID(r, 0), "quantity": 2}}}, 200)
	req := v.call(v.a, "GET", "/api/v1/transport/product-requests?date="+day, nil, 200)["items"].([]any)[0].(map[string]any)
	if req["status"] != "partial" || num(reqItem(req, 0)["remaining"]) != 0 || num(reqItem(req, 1)["remaining"]) != 1 {
		t.Fatalf("partial: %v", req)
	}
	carriers := reqItem(req, 0)["carriers"].([]any)
	if len(carriers) != 1 || carriers[0].(map[string]any)["kind"] != "order" || num(carriers[0].(map[string]any)["quantity"]) != 2 {
		t.Fatalf("carriers: %v", carriers)
	}
	// A loaded request can no longer be edited, cancelled or rejected.
	rid := itoa(int(num(r["id"])))
	v.call(v.a, "POST", "/api/v1/transport/product-requests/"+rid+"/cancel", map[string]any{}, 409)
	v.call(v.boss, "POST", "/api/v1/transport/product-requests/"+rid+"/reject", map[string]any{"note": "x"}, 409)
	// Load the rest: planned; the desk was notified.
	v.call(v.boss, "PUT", path, map[string]any{"lines": []map[string]any{{"item_id": itemID(r, 0), "quantity": 2}, {"item_id": itemID(r, 1), "quantity": 1}}}, 200)
	if st := v.call(v.a, "GET", "/api/v1/transport/product-requests?date="+day, nil, 200)["items"].([]any)[0].(map[string]any)["status"]; st != "planned" {
		t.Fatalf("planned: %v", st)
	}
	if n := count(v.e, "SELECT COUNT(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.login = 'desk_a' AND n.kind = 'transport.cargo'"); n == 0 {
		t.Fatal("the desk must be told about the cargo")
	}
	// The order is done: the request is delivered. A rejected order would give the quantity back.
	v.call(v.boss, "POST", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/status", map[string]any{"status": "accepted"}, 200)
	v.call(v.boss, "POST", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/status", map[string]any{"status": "done"}, 200)
	if st := v.call(v.a, "GET", "/api/v1/transport/product-requests?date="+day, nil, 200)["items"].([]any)[0].(map[string]any)["status"]; st != "delivered" {
		t.Fatalf("delivered: %v", st)
	}
	v.call(v.boss, "PUT", path, map[string]any{"lines": []any{}}, 409) // a closed order's cargo is frozen
}

func TestRejectedOrderGivesItsCargoBack(t *testing.T) {
	v := newV2(t)
	o := v.create(v.a, order(day, "Петренко", "d09:00"))
	r := v.request(v.a, day, [2]int64{v.cross, 2})
	v.call(v.boss, "PUT", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/cargo", map[string]any{"lines": []map[string]any{{"item_id": itemID(r, 0), "quantity": 2}}}, 200)
	v.call(v.boss, "POST", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/status", map[string]any{"status": "rejected", "note": "ні"}, 200)
	open := v.call(v.boss, "GET", "/api/v1/transport/product-requests?open=1&date="+day, nil, 200)["items"].([]any)
	if len(open) != 1 || open[0].(map[string]any)["status"] != "submitted" || num(reqItem(open[0].(map[string]any), 0)["remaining"]) != 2 {
		t.Fatalf("the quantity must come back: %v", open)
	}
}

func TestGoodsRunsCarryCargoToSeveralDesksWithCarLock(t *testing.T) {
	v := newV2(t)
	car := v.car("КА 0101 КК")
	ra := v.request(v.a, day, [2]int64{v.coffin, 1})
	rb := v.request(v.b, day, [2]int64{v.cross, 2})
	body := map[string]any{"service_date": day, "car_id": car, "time": "08:00", "stops": []map[string]any{
		{"organisation_id": v.orgA, "lines": []map[string]any{{"item_id": itemID(ra, 0), "quantity": 1}}},
		{"organisation_id": v.orgB, "place": "Склад Б", "lines": []map[string]any{{"item_id": itemID(rb, 0), "quantity": 2}}},
	}}
	// A line at the wrong desk's stop is refused.
	wrong := map[string]any{"service_date": day, "car_id": car, "time": "08:00", "stops": []map[string]any{
		{"organisation_id": v.orgA, "lines": []map[string]any{{"item_id": itemID(rb, 0), "quantity": 1}}}}}
	v.call(v.boss, "POST", "/api/v1/transport/runs", wrong, 422)
	run := v.call(v.boss, "POST", "/api/v1/transport/runs", body, 200)
	if run["kind"] != "goods" || run["status"] != "planned" || run["departure"] != "Склад" || run["car"].(map[string]any)["display"] != "КА 0101 КК" {
		t.Fatalf("%v", run)
	}
	man := run["manifest"].([]any)
	if len(man) != 2 || man[0].(map[string]any)["place"] != "Філія А" || man[1].(map[string]any)["place"] != "Склад Б" {
		t.Fatalf("manifest in route order: %v", man)
	}
	rid := itoa(int(num(run["id"])))
	// Saving the same run again does not double-count its own cargo.
	v.call(v.boss, "PATCH", "/api/v1/transport/runs/"+rid, body, 200)
	// Over-allocation across carriers: the coffin is fully on the run.
	o := v.create(v.a, order(day, "Петренко", "d15:00"))
	v.call(v.boss, "PUT", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/cargo", map[string]any{"lines": []map[string]any{{"item_id": itemID(ra, 0), "quantity": 1}}}, 422)
	// CarLock: an order on the run's car within 2 hours is refused, and a second run too.
	busy := order(day, "Зайнятий", "d09:00")
	withCar(busy, "ka-0101-kk")
	if w := v.post(v.a, "POST", "/api/v1/transport/orders", busy); w.Code != 409 || !strings.Contains(w.Body.String(), "рейсом") {
		t.Fatalf("an order on a run's car: %d %s", w.Code, w.Body)
	}
	milBusy := withCar(order(day, "Військове", "d08:30"), "КА 0101 КК")
	milBusy["military"] = true
	v.call(v.a, "POST", "/api/v1/transport/orders", milBusy, 409) // the army cannot take a goods run's car
	v.call(v.boss, "POST", "/api/v1/transport/runs", map[string]any{"service_date": day, "car_id": car, "time": "09:30", "stops": []map[string]any{{"organisation_id": v.orgA}}}, 409)
	// A run on an order's car is refused as well.
	oc := v.car("АА 7777 ВВ")
	held := order(day, "Тримає авто", "d12:00")
	withCar(held, "АА 7777 ВВ")
	v.create(v.a, held)
	v.call(v.boss, "POST", "/api/v1/transport/runs", map[string]any{"service_date": day, "car_id": oc, "time": "13:00", "stops": []map[string]any{{"organisation_id": v.orgA}}}, 409)
	// A desk sees only the runs with its stop and only its own part of the manifest; it cannot change runs.
	runsB := v.call(v.b, "GET", "/api/v1/transport/runs?date="+day, nil, 200)["items"].([]any)
	if len(runsB) != 1 || len(runsB[0].(map[string]any)["stops"].([]any)) != 1 || len(runsB[0].(map[string]any)["manifest"].([]any)) != 1 {
		t.Fatalf("desk view: %v", runsB)
	}
	v.call(v.b, "POST", "/api/v1/transport/runs/"+rid+"/status", map[string]any{"status": "in_progress"}, 403)
	// Status flow; a cancelled run frees its cargo and its car.
	v.call(v.boss, "POST", "/api/v1/transport/runs/"+rid+"/status", map[string]any{"status": "done"}, 409)
	v.call(v.boss, "POST", "/api/v1/transport/runs/"+rid+"/status", map[string]any{"status": "in_progress"}, 200)
	v.call(v.boss, "PATCH", "/api/v1/transport/runs/"+rid, body, 409)
	if n := count(v.e, "SELECT COUNT(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.login = 'desk_b' AND n.kind = 'transport.run'"); n < 2 {
		t.Fatalf("desk B must hear about the run: %d", n)
	}
	v.call(v.boss, "POST", "/api/v1/transport/runs/"+rid+"/status", map[string]any{"status": "cancelled"}, 200)
	v.call(v.boss, "PUT", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/cargo", map[string]any{"lines": []map[string]any{{"item_id": itemID(ra, 0), "quantity": 1}}}, 200)
	v.create(v.a, busy)
	// Day helpers and the board.
	days := v.e.do("GET", "/api/v1/transport/days?from="+day+"&to=2026-11-08", "", nil, v.boss)
	var dl []map[string]any
	json.Unmarshal(days.Body.Bytes(), &dl)
	if len(dl) != 1 || num(dl[0]["runs"]) != 0 || num(dl[0]["requests_open"]) != 1 {
		t.Fatalf("days: %s", days.Body)
	}
	v.request(v.a, "2026-11-08", [2]int64{v.cross, 1})
	json.Unmarshal(v.e.do("GET", "/api/v1/transport/days?from="+day+"&to=2026-11-08", "", nil, v.boss).Body.Bytes(), &dl)
	if len(dl) != 2 || dl[1]["date"] != "2026-11-08" || num(dl[1]["requests_open"]) != 1 || num(dl[1]["total"]) != 0 {
		t.Fatalf("a day with only a request must appear: %v", dl)
	}
	board := v.call(v.view, "GET", "/api/v1/transport/board?date="+day, nil, 200)
	if len(board["orders"].([]any)) != 3 || len(board["runs"].([]any)) != 1 || len(board["open_requests"].([]any)) != 2 || len(board["cars"].([]any)) != 2 {
		t.Fatalf("board: orders %d runs %d open %d cars %d", len(board["orders"].([]any)), len(board["runs"].([]any)), len(board["open_requests"].([]any)), len(board["cars"].([]any)))
	}
	v.call(v.a, "GET", "/api/v1/transport/board?date="+day, nil, 403)
}

func TestDeskPicksAFleetCarAndTheDispatcherReassigns(t *testing.T) {
	v := newV2(t)
	c1, c2 := v.car("АА 1111 АА"), v.car("ВВ 2222 ВВ")
	body := order(day, "Коваль", "d09:00", "c11:30")
	body["delivery"].(map[string]any)["car_number"] = ""
	body["delivery"].(map[string]any)["car_id"] = c1
	body["carriers"].(map[string]any)["car_number"] = "АА 1111 АА"
	body["carriers"].(map[string]any)["car_id"] = c1
	o := v.call(v.a, "POST", "/api/v1/transport/orders", body, 200)
	d := o["delivery"].(map[string]any)
	if num(d["car_id"]) != c1 || d["car_number"] != "АА 1111 АА" || o["same_car"] != true {
		t.Fatalf("%v", o)
	}
	// A legacy client typing a Latin plate is linked to the fleet car.
	legacy := order(day, "Латиниця", "d18:00")
	withCar(legacy, "bb2222bb")
	lo := v.call(v.a, "POST", "/api/v1/transport/orders", legacy, 200)
	if num(lo["delivery"].(map[string]any)["car_id"]) != c2 || lo["delivery"].(map[string]any)["car_number"] != "ВВ 2222 ВВ" {
		t.Fatalf("legacy: %v", lo["delivery"])
	}
	// The desk must choose a car; a typed number must be a fleet car or a standard plate.
	none := order(day, "Без авто", "d14:00")
	none["delivery"].(map[string]any)["car_number"] = ""
	if w := v.post(v.a, "POST", "/api/v1/transport/orders", none); w.Code != 422 || !strings.Contains(w.Body.String(), `"car_number"`) {
		t.Fatalf("no car: %d %s", w.Code, w.Body)
	}
	withCar(none, "Газель")
	v.call(v.a, "POST", "/api/v1/transport/orders", none, 422)
	none["delivery"].(map[string]any)["car_id"] = 9999
	v.call(v.a, "POST", "/api/v1/transport/orders", none, 422)
	// The dispatcher reassigns car, time and stops; CarLock applies (c2 is busy at 18:00).
	id := itoa(int(num(o["id"])))
	v.call(v.a, "PATCH", "/api/v1/transport/orders/"+id+"/assignment", map[string]any{"delivery": map[string]any{"car_id": c2}}, 403)
	v.call(v.view, "PATCH", "/api/v1/transport/orders/"+id+"/assignment", map[string]any{"delivery": map[string]any{"car_id": c2}}, 403)
	v.call(v.boss, "PATCH", "/api/v1/transport/orders/"+id+"/assignment", map[string]any{"delivery": map[string]any{"car_id": c2, "time": "17:00"}}, 409)
	as := v.call(v.boss, "PATCH", "/api/v1/transport/orders/"+id+"/assignment", map[string]any{
		"delivery": map[string]any{"car_id": c2, "time": "08:00", "stops": []string{"Церква"}},
		"carriers": map[string]any{"same_car": true, "time": "10:30"}}, 200)
	d, c := as["delivery"].(map[string]any), as["carriers"].(map[string]any)
	if num(d["car_id"]) != c2 || d["time"] != "08:00" || len(d["stops"].([]any)) != 1 || num(c["car_id"]) != c2 || c["time"] != "10:30" || c["car_number"] != "ВВ 2222 ВВ" {
		t.Fatalf("assignment: %v", as)
	}
	evs := as["events"].([]any)
	if evs[len(evs)-1].(map[string]any)["kind"] != "assignment" {
		t.Fatalf("history: %v", evs)
	}
}

func TestAcceptingNeedsACarOnEveryPart(t *testing.T) {
	v := newV2(t)
	car := v.car("АА 5555 АА")
	o := v.create(v.a, withCar(order(day, "Звичайне", "d09:00"), "АА 5555 АА"))
	mil := withCar(order(day, "Військове", "d09:30"), "АА 5555 АА")
	mil["military"] = true
	v.create(v.b, mil) // takes the car: the first order is bumped and holds none
	id := itoa(int(o.ID))
	// A bumped order can only be rejected; give it back a car through the dispatcher instead.
	v.e.st.W.Exec("UPDATE transport_orders SET status = 'submitted', delivery_car = '', delivery_car_id = NULL WHERE id = ?", o.ID)
	w := v.post(v.boss, "POST", "/api/v1/transport/orders/"+id+"/status", map[string]any{"status": "accepted"})
	if w.Code != 409 || !strings.Contains(w.Body.String(), `"code":"car_required"`) {
		t.Fatalf("car_required: %d %s", w.Code, w.Body)
	}
	other := v.car("ВВ 6666 ВВ")
	_ = car
	v.call(v.boss, "PATCH", "/api/v1/transport/orders/"+id+"/assignment", map[string]any{"delivery": map[string]any{"car_id": other}}, 200)
	v.call(v.boss, "POST", "/api/v1/transport/orders/"+id+"/status", map[string]any{"status": "accepted"}, 200)
}
