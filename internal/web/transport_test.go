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

func newDesks(t *testing.T) *desks {
	e := newEnv(t, nil)
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
	e.addUser("desk_a", "Оксана Мельник", "desk-a-pass", &d.orgA, "organisation", "transport.orders.create")
	e.addUser("desk_b", "", "desk-b-pass", &d.orgB, "organisation", "transport.orders.create")
	e.addUser("viewer", "", "viewer-pass", nil, "platform", "transport.orders.view_all")
	d.a = sessionCookie(e.login("desk_a", "desk-a-pass"))
	d.b = sessionCookie(e.login("desk_b", "desk-b-pass"))
	d.view = sessionCookie(e.login("viewer", "viewer-pass"))
	d.boss = sessionCookie(e.login("boss", "boss-pass"))
	return &d
}

func (d *desks) post(c *http.Cookie, method, path string, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	return d.e.do(method, path, string(b), nil, c)
}

func order(date, name string, parts ...string) map[string]any {
	o := map[string]any{"service_date": date, "deceased": name}
	for _, p := range parts {
		switch {
		case strings.HasPrefix(p, "d"): // delivery at HH:MM
			o["delivery"] = map[string]any{"car_number": "АА 1111 АА", "time": p[1:], "destination": "Морг"}
		case strings.HasPrefix(p, "c"): // carriers at HH:MM
			o["carriers"] = map[string]any{"count": 6, "time": p[1:], "from": "вул. Квітуча, 5", "cemetery_number": "3", "stops": []string{"Церква"}}
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
	bad := map[string]map[string]any{
		"no parts":     {"service_date": day, "deceased": "X"},
		"bad date":     order("2026-13-45", "X", "d09:00"),
		"bad time":     order(day, "X", "d25:99"),
		"empty name":   order(day, "", "d09:00"),
		"zero men":     {"service_date": day, "deceased": "X", "carriers": map[string]any{"count": 0, "time": "09:00", "from": "A"}},
		"too many men": {"service_date": day, "deceased": "X", "carriers": map[string]any{"count": 99, "time": "09:00", "from": "A"}},
		"five men":     {"service_date": day, "deceased": "X", "carriers": map[string]any{"count": 5, "time": "09:00", "from": "A"}},
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
	d.create(d.b, order(day, "Іваненко І. І.", "d09:30"))
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
