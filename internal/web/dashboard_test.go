package web

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"testing"
)

type dashJSON struct {
	Period string `json:"period"`
	Blocks []struct {
		Key   string `json:"key"`
		Tiles []struct {
			Label string  `json:"label"`
			Value float64 `json:"value"`
			Hint  string  `json:"hint"`
			Tone  string  `json:"tone"`
		} `json:"tiles"`
		Series []struct {
			Title  string `json:"title"`
			Points []struct {
				Label   string  `json:"label"`
				Value   float64 `json:"value"`
				Partial bool    `json:"partial"`
			} `json:"points"`
		} `json:"series"`
		Lists []struct {
			Title string `json:"title"`
			Rows  []struct {
				Label string  `json:"label"`
				Value float64 `json:"value"`
			} `json:"rows"`
		} `json:"lists"`
	} `json:"blocks"`
}

func (d *desks) dashboard(c *http.Cookie, period string) (dashJSON, int) {
	d.e.t.Helper()
	w := d.e.do("GET", "/api/v1/dashboard?period="+period, "", nil, c)
	var out dashJSON
	json.Unmarshal(w.Body.Bytes(), &out)
	return out, w.Code
}

func (d dashJSON) tile(block, label string) (float64, bool) {
	for _, b := range d.Blocks {
		if b.Key != block {
			continue
		}
		for _, t := range b.Tiles {
			if t.Label == label {
				return t.Value, true
			}
		}
	}
	return 0, false
}

func (d dashJSON) block(key string) bool {
	for _, b := range d.Blocks {
		if b.Key == key {
			return true
		}
	}
	return false
}

func (d *desks) exec(q string, args ...any) int64 {
	d.e.t.Helper()
	res, err := d.e.st.W.Exec(q, args...)
	if err != nil {
		d.e.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func (d *desks) summaryTotal(period string, submittedOnly bool) float64 {
	d.e.t.Helper()
	path := "/api/v1/admin/summary?period=" + period
	if submittedOnly {
		path += "&submitted_only=true"
	}
	w := d.e.do("GET", path, "", nil, d.boss)
	var s struct {
		Grand float64 `json:"grand_total_cents"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &s) != nil {
		d.e.t.Fatalf("summary: %d %s", w.Code, w.Body)
	}
	return s.Grand
}

// The dashboard's money is the summary's grand total: submitted reports only, drafts reported apart, an archived
// division that holds data counted, and quantity_calc never mixed in.
func TestDashboardRevenueEqualsTheSummary(t *testing.T) {
	d := newDesks(t)
	archived := d.exec("INSERT INTO organisations (name, archived) VALUES ('Архівна філія', 1)")
	p1 := d.exec("INSERT INTO products (name, price_cents, active, archived) VALUES ('Труна Бейка спец 3 метра', 150000, 1, 0)")
	p2 := d.exec("INSERT INTO products (name, price_cents, active, archived) VALUES ('Вінок', 25000, 1, 0)")
	report := func(org int64, period, status string, items ...[4]int64) {
		rid := d.exec("INSERT INTO reports (store_id, period, status) VALUES (?, ?, ?)", org, period, status)
		for _, it := range items { // product, quantity, calc, price
			d.exec("INSERT INTO report_items (report_id, product_id, quantity, quantity_calc, unit_price_cents) VALUES (?, ?, ?, ?, ?)", rid, it[0], it[1], it[2], it[3])
		}
	}
	for _, period := range []string{"2026-11", "2026-10"} {
		report(d.orgA, period, "submitted", [4]int64{p1, 2, 1, 150000}, [4]int64{p2, 10, 5, 25000})
		report(d.orgB, period, "draft", [4]int64{p2, 4, 0, 25000})
		report(archived, period, "submitted", [4]int64{p2, 3, 3, 20000})
	}
	for _, period := range []string{"2026-11", "2026-10"} {
		got, code := d.dashboard(d.boss, period)
		if code != 200 {
			t.Fatalf("dashboard: %d", code)
		}
		submitted, ok := got.tile("reports", "Виручка за місяць")
		if !ok || submitted != d.summaryTotal(period, true) {
			t.Fatalf("%s: dashboard revenue %v != summary %v", period, submitted, d.summaryTotal(period, true))
		}
		drafts, _ := got.tile("reports", "У чернетках")
		if want := d.summaryTotal(period, false) - d.summaryTotal(period, true); drafts != want || drafts != 100000 {
			t.Fatalf("%s: drafts %v, want %v", period, drafts, want)
		}
	}
	got, _ := d.dashboard(d.boss, "2026-11")
	var points []float64
	for _, b := range got.Blocks {
		for _, s := range b.Series {
			if s.Title == "Виручка за 12 місяців" {
				if len(s.Points) != 12 || !s.Points[11].Partial || s.Points[10].Partial {
					t.Fatalf("12 months, only the current one incomplete: %+v", s.Points)
				}
				for _, p := range s.Points {
					points = append(points, p.Value)
				}
			}
		}
	}
	if len(points) != 12 || points[11] != d.summaryTotal("2026-11", true) || points[10] != d.summaryTotal("2026-10", true) || points[0] != 0 {
		t.Fatalf("series: %v", points)
	}
	for _, b := range got.Blocks {
		for _, l := range b.Lists {
			if l.Title == "Виручка за місяць по підрозділах" {
				var sum float64
				for _, r := range l.Rows {
					sum += r.Value
				}
				if math.Abs(sum-d.summaryTotal("2026-11", true)) > 0.5 || len(l.Rows) != 2 {
					t.Fatalf("divisions add up to the revenue, the archived one included: %+v", l.Rows)
				}
			}
		}
	}
	if _, code := d.dashboard(d.boss, "2026-13"); code != 400 {
		t.Fatalf("bad month: %d", code)
	}
}

func TestDashboardIsOpenedOnlyByItsOwnViewPermission(t *testing.T) {
	d := newDesks(t)
	d.e.addUser("mgr", "", "Mgr-pass-1234", nil, "platform", "transport.orders.manage")
	d.e.addUser("rev", "", "Rev-pass-1234", nil, "platform", "reports.review")
	d.e.addUser("head", "", "Head-pass-1234", nil, "platform", "management.dashboard.view")
	mgr := sessionCookie(d.e.login("mgr", "Mgr-pass-1234"))
	rev := sessionCookie(d.e.login("rev", "Rev-pass-1234"))
	head := sessionCookie(d.e.login("head", "Head-pass-1234"))

	// Neither a desk nor the people who edit reports and orders get in through those rights.
	for name, c := range map[string]*http.Cookie{"desk": d.a, "reports.review": rev, "transport.manage": mgr, "transport.view_all": d.view} {
		if _, code := d.dashboard(c, "2026-11"); code != 403 {
			t.Fatalf("%s must not open the dashboard: %d", name, code)
		}
	}
	// The view permission alone shows the money and the transport figures, and nothing else is needed.
	got, code := d.dashboard(head, "2026-11")
	if code != 200 || !got.block("reports") || !got.block("transport") || !got.block("transport-now") {
		t.Fatalf("management.dashboard.view: %d %+v", code, got)
	}
	// The administrator holds every platform permission, this one included.
	got, code = d.dashboard(d.boss, "2026-11")
	if code != 200 || !got.block("reports") || !got.block("transport") {
		t.Fatalf("the administrator sees everything: %d %+v", code, got)
	}
	// View-only: the same person cannot change a report or an order through it.
	if w := d.e.do("GET", "/api/v1/admin/summary?period=2026-11", "", nil, head); w.Code != 403 {
		t.Fatalf("the dashboard permission opens no other data: %d", w.Code)
	}
	if w := d.post(head, "POST", "/api/v1/transport/orders/1/status", map[string]any{"status": "accepted"}); w.Code != 403 {
		t.Fatalf("and changes nothing: %d", w.Code)
	}
}

func TestDashboardTransportFigures(t *testing.T) {
	d := newDesks(t)
	day1 := "2026-11-06"
	a := d.create(d.a, order(day1, "Прийнятий", "d09:00"))
	b := d.create(d.a, order(day1, "Скасований", "d11:00"))
	mil := order(day1, "Військовий", "d13:00")
	mil["military"] = true
	d.create(d.b, mil)
	d.create(d.b, order("2026-11-20", "Заздалегідь", "d10:00"))
	d.create(d.b, order("2026-11-02", "Давній відкритий", "d10:00"))
	if w := d.post(d.boss, "POST", "/api/v1/transport/orders/"+itoa(int(a.ID))+"/status", map[string]any{"status": "accepted"}); w.Code != 200 {
		t.Fatalf("accept: %d", w.Code)
	}
	if w := d.post(d.a, "POST", "/api/v1/transport/orders/"+itoa(int(b.ID))+"/cancel", map[string]any{}); w.Code != 200 {
		t.Fatalf("cancel: %d", w.Code)
	}
	d.e.addUser("head", "", "Head-pass-1234", nil, "platform", "management.dashboard.view")
	got, code := d.dashboard(sessionCookie(d.e.login("head", "Head-pass-1234")), "2026-11")
	if code != 200 {
		t.Fatalf("dashboard: %d", code)
	}
	for label, want := range map[string]float64{"Замовлень": 5, "Скасовано підрозділами": 1, "Військові": 1, "Виконано": 0} {
		if v, ok := got.tile("transport", label); !ok || v != want {
			t.Fatalf("%q = %v (found %v), want %v", label, v, ok, want)
		}
	}
	// A desk cancelling is not the dispatcher's answer: one answer (the accepted order).
	for _, blk := range got.Blocks {
		for _, tile := range blk.Tiles {
			if tile.Label == "Час до відповіді диспетчера" && tile.Hint != "медіана, відповідей: 1" {
				t.Fatalf("only the accept counts as an answer: %q", tile.Hint)
			}
		}
	}
	if v, _ := got.tile("transport-now", "Незакриті за минулі дні"); v != 1 {
		t.Fatalf("one open order of a past day: %v", v)
	}
	if v, _ := got.tile("transport-now", "У роботі на наступні дні"); v != 1 {
		t.Fatalf("one order ahead: %v", v)
	}
	if v, _ := got.tile("transport-now", "У роботі сьогодні"); v != 2 {
		t.Fatalf("accepted + military open today: %v", v)
	}
}

// An empty list reaches the client as [], never null (the page maps over every list).
func TestDashboardSendsEmptyListsNotNull(t *testing.T) {
	d := newDesks(t)
	w := d.e.do("GET", "/api/v1/dashboard?period=2030-01", "", nil, d.boss)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if bytes.Contains(w.Body.Bytes(), []byte("null")) {
		t.Fatalf("a null in the dashboard: %s", w.Body)
	}
}

// The way the owner will do it: create the role in the role editor (platform scope, this one permission), give it to a
// user who belongs to no division, and that user opens the dashboard and nothing else.
func TestManagerRoleMadeInTheRoleEditorOpensTheDashboard(t *testing.T) {
	d := newDesks(t)
	boss := d.e.as("boss", "Boss-pass1")
	role := boss.json("POST", "/api/v1/roles", `{"name":"Керівництво","scope":"platform","permissions":["management.dashboard.view"]}`, 201)
	boss.json("POST", "/api/v1/users", `{"login":"director","password":"Director-pass-1","role_ids":[`+itoa(int(num(role["id"])))+`]}`, 201)
	head := sessionCookie(d.e.login("director", "Director-pass-1"))
	got, code := d.dashboard(head, "2026-11")
	if code != 200 || !got.block("reports") || !got.block("transport") {
		t.Fatalf("the role opens the dashboard: %d %+v", code, got)
	}
	if w := d.e.do("GET", "/api/v1/admin/overview", "", nil, head); w.Code != 200 {
		t.Fatalf("the overview endpoint is open to any signed-in user: %d", w.Code)
	}
	if w := d.e.do("GET", "/api/v1/users", "", nil, head); w.Code != 403 {
		t.Fatalf("and nothing else opens: %d", w.Code)
	}
}
