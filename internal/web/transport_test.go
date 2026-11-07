package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"legkyi/internal/platform"
)

type desks struct {
	e                *env
	a, b, boss, view *http.Cookie
	orgA, orgB       int64
}

func (e *env) addUser(login, full, pass string, org *int64, scope string, perms ...string) {
	e.t.Helper()
	tx, err := e.st.W.Begin()
	if err != nil {
		e.t.Fatal(err)
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO roles ("key", name, scope, organisation_id) VALUES (NULL, ?, ?, NULL)`, "Роль "+login, scope)
	if err != nil {
		e.t.Fatal(err)
	}
	role, _ := res.LastInsertId()
	for _, p := range perms {
		if _, err := tx.Exec("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)", role, p); err != nil {
			e.t.Fatal(err)
		}
	}
	hash, _ := platform.HashPassword(pass, nil)
	id, err := platform.CreateUser(tx, login, hash, org, time.Now(), role)
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := tx.Exec("UPDATE users SET full_name = ? WHERE id = ?", full, id); err != nil {
		e.t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		e.t.Fatal(err)
	}
}

func newDesks(t *testing.T) *desks { return newDesksWith(t, nil) }

func newDesksWith(t *testing.T, mut func(*Deps)) *desks {
	e := newEnv(t, mut)
	var d desks
	d.e = e
	for i, name := range []string{"Філія А", "Філія Б"} {
		res, err := e.st.W.Exec("INSERT INTO organisations (name, archived) VALUES (?, 0)", name)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		if i == 0 {
			d.orgA = id
		} else {
			d.orgB = id
		}
	}
	e.addUser("desk_a", "Оксана Мельник", "Desk-a-pass1", &d.orgA, "organisation", "transport.orders.create")
	e.addUser("desk_b", "", "Desk-b-pass1", &d.orgB, "organisation", "transport.orders.create")
	e.addUser("viewer", "", "Viewer-pass1", nil, "platform", "transport.orders.view_all")
	d.a = sessionCookie(e.login("desk_a", "Desk-a-pass1"))
	d.b = sessionCookie(e.login("desk_b", "Desk-b-pass1"))
	d.view = sessionCookie(e.login("viewer", "Viewer-pass1"))
	d.boss = sessionCookie(e.login("boss", "Boss-pass1"))
	return &d
}

func (d *desks) post(c *http.Cookie, method, path string, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	return d.e.do(method, path, string(b), nil, c)
}

// carFor gives every deceased its own car, so orders written for other purposes do not meet on one car.
func carFor(name string) string {
	n := 0
	for _, r := range strings.Join(strings.Fields(strings.ToLower(name)), " ") {
		n = (n*31 + int(r)) % 9000
	}
	return "АА " + itoa(1000+n) + " АА"
}

func withCar(o map[string]any, car string) map[string]any {
	for _, part := range []string{"delivery", "carriers"} {
		if m, ok := o[part].(map[string]any); ok {
			m["car_number"] = car
		}
	}
	return o
}

func order(date, name string, parts ...string) map[string]any {
	o := map[string]any{"service_date": date, "deceased": name}
	for _, p := range parts {
		switch {
		case strings.HasPrefix(p, "d"): // delivery at HH:MM
			o["delivery"] = map[string]any{"car_number": carFor(name), "departure": "вул. Квітуча, 5", "time": p[1:], "destination": "Морг"}
		case strings.HasPrefix(p, "c"): // carriers at HH:MM
			o["carriers"] = map[string]any{"car_number": carFor(name), "departure": "Морг", "count": 6, "time": p[1:], "cemetery_number": "3", "stops": []string{"Церква"}}
		}
	}
	return o
}

type orderJSON struct {
	ID           int64    `json:"id"`
	Deceased     string   `json:"deceased"`
	Status       string   `json:"status"`
	ReplyNote    string   `json:"reply_note"`
	SubmittedBy  string   `json:"submitted_by"`
	SortTime     string   `json:"sort_time"`
	CanEdit      bool     `json:"can_edit"`
	NextStatuses []string `json:"next_statuses"`
	Organisation struct {
		Name string `json:"name"`
	} `json:"organisation"`
	Delivery *struct {
		Time string `json:"time"`
	} `json:"delivery"`
	Carriers *struct {
		Time    string   `json:"time"`
		Stops   []string `json:"stops"`
		Bearers []string `json:"bearers"`
	} `json:"carriers"`
	Events []struct {
		Kind, Status, Note string
		UserName           string `json:"user_name"`
	} `json:"events"`
}

func (d *desks) create(c *http.Cookie, body map[string]any) orderJSON {
	d.e.t.Helper()
	w := d.post(c, "POST", "/api/v1/transport/orders", body)
	if w.Code != 200 {
		d.e.t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var o orderJSON
	json.Unmarshal(w.Body.Bytes(), &o)
	return o
}

func (d *desks) list(c *http.Cookie, query string) []orderJSON {
	d.e.t.Helper()
	w := d.e.do("GET", "/api/v1/transport/orders?"+query, "", nil, c)
	if w.Code != 200 {
		d.e.t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	var out []orderJSON
	json.Unmarshal(w.Body.Bytes(), &out)
	return out
}

const day = "2026-11-06"

func TestDeskSubmitsAndSignsAnOrder(t *testing.T) {
	d := newDesks(t)
	o := d.create(d.a, order(day, "Іваненко І. І.", "d09:30", "c12:00"))
	if o.Status != "submitted" || o.SubmittedBy != "Оксана Мельник" || o.Organisation.Name != "Філія А" || !o.CanEdit {
		t.Fatalf("%+v", o)
	}
	if o.Delivery == nil || o.Carriers == nil || o.SortTime != "09:30" || len(o.Carriers.Stops) != 1 {
		t.Fatalf("both parts must be kept together: %+v", o)
	}
	// A desk without a full name is signed with its login.
	if b := d.create(d.b, order(day, "Петренко П. П.", "d10:00")); b.SubmittedBy != "desk_b" {
		t.Fatalf("signature: %q", b.SubmittedBy)
	}
}

func TestDayListIsChronologicalAcrossDesksAndKeepsPartsTogether(t *testing.T) {
	d := newDesks(t)
	d.create(d.a, order(day, "Пізній", "d12:00"))
	d.create(d.b, order(day, "Ранній винос і доставка", "d10:00", "c08:30"))
	d.create(d.a, order(day, "Середній", "c09:15"))
	d.create(d.a, order("2026-11-07", "Інший день", "d07:00"))

	got := d.list(d.boss, "date="+day)
	var names []string
	for _, o := range got {
		names = append(names, o.Deceased)
	}
	want := []string{"Ранній винос і доставка", "Середній", "Пізній"}
	if strings.Join(names, "|") != strings.Join(want, "|") {
		t.Fatalf("order of the day: %v, want %v", names, want)
	}
	if got[0].Delivery == nil || got[0].Carriers == nil {
		t.Fatal("delivery and carriers of one deceased must stay in one row")
	}
	if n := len(d.list(d.boss, "from=2026-11-06&to=2026-11-07")); n != 4 {
		t.Fatalf("history range: %d", n)
	}
	if n := len(d.list(d.boss, "date="+day+"&organisation_id="+itoa(int(d.orgB)))); n != 1 {
		t.Fatalf("organisation filter: %d", n)
	}
}

func TestDesksSeeOnlyTheirOwnOrders(t *testing.T) {
	d := newDesks(t)
	a := d.create(d.a, order(day, "Для А", "d09:00"))
	d.create(d.b, order(day, "Для Б", "d09:30"))
	if got := d.list(d.a, "date="+day); len(got) != 1 || got[0].Deceased != "Для А" {
		t.Fatalf("desk A sees %+v", got)
	}
	if got := d.list(d.a, "date="+day+"&organisation_id="+itoa(int(d.orgB))); len(got) != 1 || got[0].Deceased != "Для А" {
		t.Fatal("a desk cannot widen its view with organisation_id")
	}
	if w := d.e.do("GET", "/api/v1/transport/orders/"+itoa(int(a.ID)), "", nil, d.b); w.Code != 404 {
		t.Fatalf("another organisation's order: %d", w.Code)
	}
	if w := d.post(d.b, "PUT", "/api/v1/transport/orders/"+itoa(int(a.ID)), order(day, "Підміна", "d09:00")); w.Code != 404 {
		t.Fatalf("editing another organisation's order: %d", w.Code)
	}
	if w := d.post(d.b, "POST", "/api/v1/transport/orders/"+itoa(int(a.ID))+"/cancel", map[string]any{}); w.Code != 404 {
		t.Fatalf("cancelling another organisation's order: %d", w.Code)
	}
}

func TestOrderValidation(t *testing.T) {
	d := newDesks(t)
	crew := func(over map[string]any) map[string]any {
		c := map[string]any{"car_number": "АА 1", "departure": "Морг", "count": 6, "time": "09:00", "cemetery_number": "3", "stops": []string{"Церква"}}
		for k, v := range over {
			c[k] = v
		}
		return map[string]any{"service_date": day, "deceased": "X", "carriers": c}
	}
	noCar := order(day, "X", "d09:00")
	delete(noCar["delivery"].(map[string]any), "car_number")
	noDeparture := order(day, "X", "d09:00")
	noDeparture["delivery"].(map[string]any)["departure"] = "  "
	noCrewCar := crew(map[string]any{"car_number": " "})
	bad := map[string]map[string]any{
		"no parts":         {"service_date": day, "deceased": "X"},
		"no crew car":      noCrewCar,
		"no crew from":     crew(map[string]any{"departure": ""}),
		"no delivery car":  noCar,
		"no delivery from": noDeparture,
		"bad date":         order("2026-13-45", "X", "d09:00"),
		"bad time":         order(day, "X", "d25:99"),
		"empty name":       order(day, "", "d09:00"),
		"zero men":         crew(map[string]any{"count": 0}),
		"too many men":     crew(map[string]any{"count": 99}),
		"five men":         crew(map[string]any{"count": 5}),
		"no stops":         crew(map[string]any{"stops": []string{}}),
		"blank stop":       crew(map[string]any{"stops": []string{" "}}),
		"no cemetery":      crew(map[string]any{"cemetery_number": ""}),
	}
	if w := d.post(d.a, "POST", "/api/v1/transport/orders", crew(nil)); w.Code != 200 {
		t.Fatalf("a complete crew order must pass: %d %s", w.Code, w.Body)
	}
	for name, body := range bad {
		if w := d.post(d.a, "POST", "/api/v1/transport/orders", body); w.Code != 422 {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	// Platform staff cannot place orders (they belong to no organisation).
	if w := d.post(d.boss, "POST", "/api/v1/transport/orders", order(day, "X", "d09:00")); w.Code != 403 {
		t.Errorf("staff creating: %d", w.Code)
	}
}

func TestDispatcherRepliesAndDeskFollowsTheStatus(t *testing.T) {
	d := newDesks(t)
	o := d.create(d.a, order(day, "Іваненко", "d09:00"))
	id := itoa(int(o.ID))
	status := func(c *http.Cookie, st, note string) *httptest.ResponseRecorder {
		return d.post(c, "POST", "/api/v1/transport/orders/"+id+"/status", map[string]any{"status": st, "note": note})
	}
	if w := status(d.a, "accepted", ""); w.Code != 403 {
		t.Fatalf("a desk cannot reply: %d", w.Code)
	}
	if w := status(d.view, "accepted", ""); w.Code != 403 {
		t.Fatalf("view_all alone cannot reply: %d", w.Code)
	}
	if w := status(d.boss, "done", ""); w.Code != 409 {
		t.Fatalf("submitted -> done must be refused: %d", w.Code)
	}
	if w := status(d.boss, "rejected", ""); w.Code != 422 {
		t.Fatalf("a rejection needs a reason: %d", w.Code)
	}
	w := status(d.boss, "accepted", "Авто виїде о 8:40")
	var after orderJSON
	json.Unmarshal(w.Body.Bytes(), &after)
	if w.Code != 200 || after.Status != "accepted" || len(after.NextStatuses) != 3 {
		t.Fatalf("accept: %d %s", w.Code, w.Body)
	}

	// The desk sees the reply (polling) but can no longer edit or cancel.
	seen := d.list(d.a, "date="+day)[0]
	if seen.Status != "accepted" || seen.ReplyNote != "Авто виїде о 8:40" || seen.CanEdit {
		t.Fatalf("desk view: %+v", seen)
	}
	if w := d.post(d.a, "PUT", "/api/v1/transport/orders/"+id, order(day, "Іваненко", "d10:00")); w.Code != 409 {
		t.Fatalf("editing after the reply: %d", w.Code)
	}
	if w := d.post(d.a, "POST", "/api/v1/transport/orders/"+id+"/cancel", map[string]any{}); w.Code != 409 {
		t.Fatalf("cancelling after the reply: %d", w.Code)
	}
	for _, st := range []string{"in_progress", "done"} {
		if w := status(d.boss, st, ""); w.Code != 200 {
			t.Fatalf("%s: %d %s", st, w.Code, w.Body)
		}
		// Later steps without a note must not erase the dispatcher's reply the desk is reading.
		if got := d.list(d.a, "date="+day)[0]; got.ReplyNote != "Авто виїде о 8:40" || got.Status != st {
			t.Fatalf("after %s the desk sees %+v", st, got)
		}
	}
	if w := status(d.boss, "in_progress", ""); w.Code != 409 {
		t.Fatalf("a finished order stays finished: %d", w.Code)
	}

	// History: staff see every event with who did it; the desk gets none.
	var staff, desk orderJSON
	json.Unmarshal(d.e.do("GET", "/api/v1/transport/orders/"+id, "", nil, d.boss).Body.Bytes(), &staff)
	json.Unmarshal(d.e.do("GET", "/api/v1/transport/orders/"+id, "", nil, d.a).Body.Bytes(), &desk)
	if len(staff.Events) != 4 || staff.Events[0].Kind != "created" || staff.Events[0].UserName != "Оксана Мельник" || staff.Events[1].Note != "Авто виїде о 8:40" {
		t.Fatalf("history: %+v", staff.Events)
	}
	if len(desk.Events) != 0 {
		t.Fatal("the desk does not get the history")
	}
	var viewer orderJSON
	json.Unmarshal(d.e.do("GET", "/api/v1/transport/orders/"+id, "", nil, d.view).Body.Bytes(), &viewer)
	if len(viewer.Events) != 4 || len(viewer.NextStatuses) != 0 {
		t.Fatalf("view_all sees the history but cannot act: %+v", viewer)
	}
}

func TestDeskEditsAndCancelsWhileSubmitted(t *testing.T) {
	d := newDesks(t)
	o := d.create(d.a, order(day, "Іваненко", "d09:00"))
	id := itoa(int(o.ID))
	w := d.post(d.a, "PUT", "/api/v1/transport/orders/"+id, order(day, "Іваненко І.", "d09:00", "c11:30"))
	var edited orderJSON
	json.Unmarshal(w.Body.Bytes(), &edited)
	if w.Code != 200 || edited.Carriers == nil || edited.Deceased != "Іваненко І." {
		t.Fatalf("edit: %d %s", w.Code, w.Body)
	}
	if w := d.post(d.a, "POST", "/api/v1/transport/orders/"+id+"/cancel", map[string]any{}); w.Code != 200 {
		t.Fatalf("cancel: %d %s", w.Code, w.Body)
	}
	if got := d.list(d.a, "date="+day); got[0].Status != "cancelled" {
		t.Fatalf("%+v", got)
	}
	var n int
	d.e.st.R.QueryRow("SELECT COUNT(*) FROM audit_log WHERE action IN ('створено замовлення транспорту','змінено замовлення транспорту','скасовано замовлення транспорту')").Scan(&n)
	if n != 3 {
		t.Fatalf("audit rows: %d", n)
	}
}

func TestOrganisationWithTransportOrdersIsArchivedNotDeleted(t *testing.T) {
	d := newDesks(t)
	d.create(d.a, order(day, "Іваненко", "d09:00"))
	w := d.e.do("DELETE", "/api/v1/organisations/"+itoa(int(d.orgA)), "", nil, d.boss)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"archived":true`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestOrdersOfOneDeceasedStayTogether(t *testing.T) {
	d := newDesks(t)
	d.create(d.a, order(day, "Іваненко І. І.", "d09:00"))
	d.create(d.a, order(day, "Мартинюк М. М.", "d10:00"))
	// The carriers part is ordered later, as a second order of the same deceased (different spacing and case).
	d.create(d.a, order(day, "  іваненко  і. і. ", "c14:00"))
	// Another desk's deceased with the same name is a different person's order.
	d.create(d.b, withCar(order(day, "Іваненко І. І.", "d09:30"), "ВВ 2222 ВВ"))
	var got []string
	for _, o := range d.list(d.boss, "date="+day) {
		got = append(got, o.Organisation.Name+":"+strings.TrimSpace(o.Deceased)+"@"+o.SortTime)
	}
	want := "Філія А:Іваненко І. І.@09:00|Філія А:іваненко  і. і.@14:00|Філія Б:Іваненко І. І.@09:30|Філія А:Мартинюк М. М.@10:00"
	if strings.Join(got, "|") != want {
		t.Fatalf("got  %v\nwant %s", got, want)
	}
}

func TestRangeNeedsBothDates(t *testing.T) {
	d := newDesks(t)
	if w := d.e.do("GET", "/api/v1/transport/orders?from=2026-01-01", "", nil, d.boss); w.Code != 400 {
		t.Fatalf("%d", w.Code)
	}
	if w := d.e.do("GET", "/api/v1/transport/orders?from=2026-01-01&to=2027-03-01", "", nil, d.boss); w.Code != 400 {
		t.Fatalf("over 400 days: %d", w.Code)
	}
}

func TestDispatcherAssignsBearersAndTheyShowOnTheDesk(t *testing.T) {
	d := newDesks(t)
	o := d.create(d.a, order(day, "Іваненко", "c12:00")) // crew of 6
	d2 := d.create(d.a, order(day, "Без виносу", "d09:00"))
	path := "/api/v1/transport/orders/" + itoa(int(o.ID)) + "/bearers"
	put := func(c *http.Cookie, id string, names ...string) *httptest.ResponseRecorder {
		return d.post(c, "PUT", "/api/v1/transport/orders/"+id+"/bearers", map[string]any{"names": names})
	}
	if w := put(d.a, itoa(int(o.ID)), "А"); w.Code != 403 {
		t.Fatalf("a desk cannot assign: %d", w.Code)
	}
	if w := put(d.view, itoa(int(o.ID)), "А"); w.Code != 403 {
		t.Fatalf("view_all cannot assign: %d", w.Code)
	}
	if w := put(d.boss, itoa(int(d2.ID)), "А"); w.Code != 409 {
		t.Fatalf("an order without carriers: %d", w.Code)
	}
	if w := put(d.boss, itoa(int(o.ID)), "1", "2", "3", "4", "5", "6", "7"); w.Code != 422 && w.Code != 400 {
		t.Fatalf("more than six: %d", w.Code)
	}
	if w := put(d.boss, itoa(int(o.ID)), "  "); w.Code != 422 {
		t.Fatalf("blank name: %d", w.Code)
	}
	w := put(d.boss, itoa(int(o.ID)), "Петренко О.", "Коваль І.", "Шевчук Д.", "Мороз В.")
	var got orderJSON
	json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != 200 || got.Carriers == nil || len(got.Carriers.Bearers) != 4 || got.Events[len(got.Events)-1].Kind != "bearers" {
		t.Fatalf("assign: %d %s", w.Code, w.Body)
	}
	if seen := d.list(d.a, "date="+day)[1]; seen.Carriers == nil || seen.Carriers.Bearers[0] != "Петренко О." {
		t.Fatalf("the desk sees the crew: %+v", seen)
	}
	_ = path
	// A desk edit keeps the crew but cuts it to a smaller ordered size.
	edited := order(day, "Іваненко", "c12:00")
	edited["carriers"].(map[string]any)["count"] = 4
	if w := d.post(d.a, "PUT", "/api/v1/transport/orders/"+itoa(int(o.ID)), edited); w.Code != 200 {
		t.Fatalf("edit: %d %s", w.Code, w.Body)
	}
	if kept := d.list(d.boss, "date="+day)[1]; len(kept.Carriers.Bearers) != 4 {
		t.Fatalf("crew after edit: %+v", kept.Carriers)
	}
	// Four men cannot be more than ordered.
	if w := put(d.boss, itoa(int(o.ID)), "1", "2", "3", "4", "5"); w.Code != 422 {
		t.Fatalf("over the ordered crew: %d", w.Code)
	}
	// A rejected order takes no crew.
	d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/status", map[string]any{"status": "rejected", "note": "x"})
	if w := put(d.boss, itoa(int(o.ID)), "А"); w.Code != 409 {
		t.Fatalf("rejected: %d", w.Code)
	}
}

func TestOneCarForBothPartsOrAnotherCarToCarry(t *testing.T) {
	d := newDesks(t)
	same := d.create(d.a, order(day, "Одна машина", "d10:00", "c11:30"))
	other := order(day, "Дві машини", "d10:30", "c12:00")
	other["carriers"].(map[string]any)["car_number"] = "КК 7777 КК"
	two := d.create(d.a, other)
	var sameRaw, twoRaw struct {
		SameCar  bool `json:"same_car"`
		Delivery struct {
			CarNumber string `json:"car_number"`
		}
		Carriers struct {
			CarNumber string `json:"car_number"`
		}
	}
	for id, dst := range map[int64]any{same.ID: &sameRaw, two.ID: &twoRaw} {
		json.Unmarshal(d.e.do("GET", "/api/v1/transport/orders/"+itoa(int(id)), "", nil, d.boss).Body.Bytes(), dst)
	}
	if !sameRaw.SameCar || twoRaw.SameCar || twoRaw.Delivery.CarNumber != carFor("Дві машини") || twoRaw.Carriers.CarNumber != "КК 7777 КК" {
		t.Fatalf("same %+v two %+v", sameRaw, twoRaw)
	}
	// One car's two runs (delivery 10:00, carrying 11:30) are one row: no other order lands between them
	// (the 11:00 order of another desk comes after the whole row).
	d.create(d.b, order(day, "Після", "d11:00"))
	got := d.list(d.boss, "date="+day)
	if got[0].Deceased != "Одна машина" || got[1].Deceased != "Дві машини" || got[2].Deceased != "Після" {
		t.Fatalf("order of the day: %v %v %v", got[0].Deceased, got[1].Deceased, got[2].Deceased)
	}
}

func TestADispatcherMayBelongToADivision(t *testing.T) {
	d := newDesks(t)
	// A role is a plain set of permissions: one person of division A may both place A's orders and handle everyone's.
	d.e.addUser("dual", "Двоєдина", "Dual-pass1", &d.orgA, "organisation", "transport.orders.create", "transport.orders.manage")
	dual := sessionCookie(d.e.login("dual", "Dual-pass1"))
	d.create(d.b, order(day, "Чужий", "d09:00"))
	if got := d.list(dual, "date="+day); len(got) != 1 || got[0].Deceased != "Чужий" {
		t.Fatalf("a holder of manage sees every division's orders: %+v", got)
	}
	own := d.create(dual, order(day, "Свій", "d10:00"))
	if own.Organisation.Name != "Філія А" || own.SubmittedBy != "Двоєдина" {
		t.Fatalf("their own orders belong to their division: %+v", own)
	}
	other := d.list(dual, "date="+day)[0]
	w := d.post(dual, "POST", "/api/v1/transport/orders/"+itoa(int(other.ID))+"/status", map[string]any{"status": "accepted", "note": ""})
	if w.Code != 200 {
		t.Fatalf("handling another division's order: %d %s", w.Code, w.Body)
	}
	// Without the handling permission a desk still sees only its own division.
	if got := d.list(d.a, "date="+day); len(got) != 1 || got[0].Deceased != "Свій" {
		t.Fatalf("a plain desk is still limited to its division: %+v", got)
	}
}

func TestHandlingOtherDivisionsOrdersNeverMeansRewritingThem(t *testing.T) {
	d := newDesks(t)
	d.e.addUser("dual", "Двоєдина", "Dual-pass1", &d.orgA, "organisation", "transport.orders.create", "transport.orders.manage")
	dual := sessionCookie(d.e.login("dual", "Dual-pass1"))
	foreign := d.create(d.b, order(day, "Чужий", "d09:00"))
	id := itoa(int(foreign.ID))
	if w := d.post(dual, "PUT", "/api/v1/transport/orders/"+id, order(day, "Підміна", "d10:00")); w.Code != 404 {
		t.Fatalf("editing another division's order: %d", w.Code)
	}
	if w := d.post(dual, "POST", "/api/v1/transport/orders/"+id+"/cancel", map[string]any{}); w.Code != 404 {
		t.Fatalf("cancelling another division's order: %d", w.Code)
	}
	// Reading and replying are what manage is for.
	if w := d.post(dual, "POST", "/api/v1/transport/orders/"+id+"/status", map[string]any{"status": "accepted", "note": ""}); w.Code != 200 {
		t.Fatalf("replying: %d", w.Code)
	}
	if got := d.list(d.b, "date="+day); got[0].Deceased != "Чужий" || got[0].Status != "accepted" {
		t.Fatalf("the order stayed as the owner wrote it: %+v", got[0])
	}
}

// --- car occupancy and military priority ---------------------------------------------------------------------

func (d *desks) createStatus(c *http.Cookie, body map[string]any) (int, string) {
	w := d.post(c, "POST", "/api/v1/transport/orders", body)
	return w.Code, w.Body.String()
}

func (d *desks) get(c *http.Cookie, id int64) orderJSON {
	d.e.t.Helper()
	var o orderJSON
	w := d.e.do("GET", "/api/v1/transport/orders/"+itoa(int(id)), "", nil, c)
	if w.Code != 200 {
		d.e.t.Fatalf("get %d: %d %s", id, w.Code, w.Body)
	}
	json.Unmarshal(w.Body.Bytes(), &o)
	return o
}

func sameCarOrder(name, car string, parts ...string) map[string]any {
	return withCar(order(day, name, parts...), car)
}

func TestACarIsLockedForTwoHoursAfterAnOrder(t *testing.T) {
	d := newDesks(t)
	d.create(d.a, sameCarOrder("Перший", "АА 5555 АА", "d10:00"))
	// Less than two hours later, on any desk: refused, with the busy window in the message.
	for _, at := range []string{"d10:00", "d11:59", "d08:01"} {
		code, body := d.createStatus(d.b, sameCarOrder("Другий", "аа5555аа", at))
		if code != 409 || !strings.Contains(body, "10:00–12:00") {
			t.Fatalf("%s: %d %s", at, code, body)
		}
	}
	// Exactly two hours away, another car, or another day is free.
	d.create(d.b, sameCarOrder("Рівно через дві години", "АА 5555 АА", "d12:00"))
	d.create(d.b, sameCarOrder("Раніше на дві години", "АА 5555 АА", "d08:00"))
	d.create(d.b, sameCarOrder("Інше авто", "АА 6666 АА", "d10:00"))
	other := sameCarOrder("Інший день", "АА 5555 АА", "d10:00")
	other["service_date"] = "2026-11-07"
	d.create(d.b, other)
}

func TestTheCarLockCrossesMidnight(t *testing.T) {
	d := newDesks(t)
	late := sameCarOrder("Пізній", "АА 5555 АА", "d23:30")
	d.create(d.a, late)
	next := sameCarOrder("Наступного дня", "АА 5555 АА", "d00:30")
	next["service_date"] = "2026-11-07"
	if code, body := d.createStatus(d.b, next); code != 409 {
		t.Fatalf("%d %s", code, body)
	}
}

func TestBothPartsOfOneOrderMayUseTheSameCarCloseTogether(t *testing.T) {
	d := newDesks(t)
	o := d.create(d.a, sameCarOrder("Один рейс", "АА 5555 АА", "d10:00", "c10:30"))
	// Editing keeps working: the order never clashes with its own old content.
	w := d.post(d.a, "PUT", "/api/v1/transport/orders/"+itoa(int(o.ID)), sameCarOrder("Один рейс", "АА 5555 АА", "d10:15", "c10:45"))
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	// But a second order's part on the same car inside the window of either part is refused.
	if code, _ := d.createStatus(d.b, sameCarOrder("Чужий", "АА 5555 АА", "c11:30")); code != 409 {
		t.Fatalf("carriers part on the busy car: %d", code)
	}
}

func TestOrdersThatReleaseTheirCarDoNotBlockIt(t *testing.T) {
	d := newDesks(t)
	for i, release := range []func(o orderJSON){
		func(o orderJSON) { d.post(d.a, "POST", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/cancel", nil) },
		func(o orderJSON) {
			d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/status", map[string]any{"status": "rejected", "note": "немає"})
		},
		func(o orderJSON) {
			d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/status", map[string]any{"status": "done"})
		},
	} {
		car := "АА 70" + itoa(10+i) + " АА"
		o := d.create(d.a, sameCarOrder("Звільняє "+itoa(i), car, "d10:00"))
		if i == 2 {
			d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/status", map[string]any{"status": "accepted"})
		}
		release(o)
		if code, body := d.createStatus(d.b, sameCarOrder("Після "+itoa(i), car, "d10:30")); code != 200 {
			t.Fatalf("case %d: %d %s", i, code, body)
		}
	}
}

func TestMilitaryOrderTakesTheCarFromAnOrdinaryOne(t *testing.T) {
	d := newDesks(t)
	civil := d.create(d.a, sameCarOrder("Цивільний", "АА 5555 АА", "d10:00"))
	d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(civil.ID))+"/status", map[string]any{"status": "accepted"})
	mil := sameCarOrder("Військовий", "АА 5555 АА", "d11:00")
	mil["military"] = true
	m := d.create(d.b, mil)
	if got := d.get(d.boss, m.ID); got.Status != "submitted" {
		t.Fatalf("military order: %+v", got)
	}
	got := d.get(d.boss, civil.ID)
	if got.Status != "bumped" || !strings.Contains(got.ReplyNote, "військове") || len(got.Events) == 0 || got.Events[len(got.Events)-1].Kind != "bumped" {
		t.Fatalf("bumped order: %+v", got)
	}
	if n := count(d.e, "SELECT COUNT(*) FROM audit_log WHERE action = 'знято авто із замовлення транспорту'"); n != 1 {
		t.Fatalf("audit rows: %d", n)
	}
	// The desk can still edit and cancel it; the old car and time stay refused, a new time works and resubmits.
	if !d.get(d.a, civil.ID).CanEdit {
		t.Fatal("a bumped order must stay editable")
	}
	if w := d.post(d.a, "PUT", "/api/v1/transport/orders/"+itoa(int(civil.ID)), sameCarOrder("Цивільний", "АА 5555 АА", "d10:30")); w.Code != 409 {
		t.Fatalf("same car, still busy: %d %s", w.Code, w.Body)
	}
	if got := d.get(d.boss, civil.ID); got.Status != "bumped" {
		t.Fatalf("a refused edit must not resubmit: %s", got.Status)
	}
	if w := d.post(d.a, "PUT", "/api/v1/transport/orders/"+itoa(int(civil.ID)), sameCarOrder("Цивільний", "АА 5555 АА", "d14:00")); w.Code != 200 {
		t.Fatalf("new time: %d %s", w.Code, w.Body)
	}
	if got := d.get(d.boss, civil.ID); got.Status != "submitted" {
		t.Fatalf("after the edit: %s", got.Status)
	}
}

func TestMilitaryOrderCannotTakeTheCarFromAnotherMilitaryOrderOrARunningTrip(t *testing.T) {
	d := newDesks(t)
	m1 := sameCarOrder("Військовий 1", "АА 5555 АА", "d10:00")
	m1["military"] = true
	d.create(d.a, m1)
	m2 := sameCarOrder("Військовий 2", "АА 5555 АА", "d10:30")
	m2["military"] = true
	if code, body := d.createStatus(d.b, m2); code != 409 || !strings.Contains(body, "військовим") {
		t.Fatalf("%d %s", code, body)
	}
	run := d.create(d.a, sameCarOrder("У дорозі", "АА 8888 АА", "d10:00"))
	for _, st := range []string{"accepted", "in_progress"} {
		d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(run.ID))+"/status", map[string]any{"status": st})
	}
	m3 := sameCarOrder("Військовий 3", "АА 8888 АА", "d10:30")
	m3["military"] = true
	if code, body := d.createStatus(d.b, m3); code != 409 || !strings.Contains(body, "виконує") {
		t.Fatalf("%d %s", code, body)
	}
	if got := d.get(d.boss, run.ID); got.Status != "in_progress" {
		t.Fatalf("the running trip was touched: %s", got.Status)
	}
}

func TestAFailedMilitaryOrderBumpsNothing(t *testing.T) {
	d := newDesks(t)
	civil := d.create(d.a, sameCarOrder("Цивільний", "АА 5555 АА", "d10:00"))
	run := d.create(d.a, sameCarOrder("У дорозі", "АА 5555 АА", "d12:00"))
	for _, st := range []string{"accepted", "in_progress"} {
		d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(run.ID))+"/status", map[string]any{"status": st})
	}
	mil := sameCarOrder("Військовий", "АА 5555 АА", "d11:00") // meets both: the trip blocks it, so the civil one stays
	mil["military"] = true
	if code, _ := d.createStatus(d.b, mil); code != 409 {
		t.Fatalf("expected 409, got %d", code)
	}
	if got := d.get(d.boss, civil.ID); got.Status != "submitted" {
		t.Fatalf("an order was bumped by a refused request: %s", got.Status)
	}
}

type dayJSON struct {
	Date      string         `json:"date"`
	Total     int            `json:"total"`
	Open      int            `json:"open"`
	Attention int            `json:"attention"`
	ByStatus  map[string]int `json:"by_status"`
}

func (d *desks) days(c *http.Cookie, query string) map[string]dayJSON {
	d.e.t.Helper()
	w := d.e.do("GET", "/api/v1/transport/days?"+query, "", nil, c)
	if w.Code != 200 {
		d.e.t.Fatalf("days: %d %s", w.Code, w.Body)
	}
	var list []dayJSON
	json.Unmarshal(w.Body.Bytes(), &list)
	out := map[string]dayJSON{}
	for _, x := range list {
		out[x.Date] = x
	}
	return out
}

func TestDayStripCountsOpenOrdersPerCaller(t *testing.T) {
	d := newDesks(t)
	later := "2026-11-13" // paid today, buried in a week: still open all week
	a1 := d.create(d.a, order(day, "Сьогоднішній", "d09:00"))
	d.create(d.a, order(later, "Через тиждень", "c11:00"))
	d.create(d.b, order(day, "Чужий", "d10:00"))
	if w := d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(a1.ID))+"/status", map[string]any{"status": "accepted"}); w.Code != 200 {
		t.Fatalf("accept: %d %s", w.Code, w.Body)
	}
	if w := d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(a1.ID))+"/status", map[string]any{"status": "done"}); w.Code != 200 {
		t.Fatalf("done: %d %s", w.Code, w.Body)
	}

	q := "from=2026-11-01&to=2026-11-30"
	desk := d.days(d.a, q)
	if len(desk) != 2 || desk[day].Total != 1 || desk[day].Open != 0 || desk[later].Open != 1 {
		t.Fatalf("desk A counts only its own orders: %+v", desk)
	}
	if desk[later].Attention != 0 {
		t.Fatalf("a desk waits only for orders whose car was taken: %+v", desk[later])
	}
	if got := d.days(d.a, q+"&organisation_id="+itoa(int(d.orgB))); got[day].Total != 1 || got[day].ByStatus["done"] != 1 {
		t.Fatalf("a desk cannot widen the strip with organisation_id: %+v", got)
	}

	boss := d.days(d.boss, q)
	if boss[day].Total != 2 || boss[day].Open != 1 || boss[day].Attention != 1 || boss[later].Attention != 1 {
		t.Fatalf("dispatcher sees every desk and the submitted orders wait for them: %+v", boss)
	}
	if got := d.days(d.boss, q+"&organisation_id="+itoa(int(d.orgB))); len(got) != 1 || got[day].Total != 1 {
		t.Fatalf("organisation filter: %+v", got)
	}
	if w := d.e.do("GET", "/api/v1/transport/days?from=2026-11-01", "", nil, d.boss); w.Code != 400 {
		t.Fatalf("a range needs both dates: %d", w.Code)
	}
}
