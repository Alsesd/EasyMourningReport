package web

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

type dayLine struct {
	ID     int64 `json:"id"`
	Inputs []struct {
		PriceCents   int64 `json:"price_cents"`
		Quantity     int64 `json:"quantity"`
		QuantityCalc int64 `json:"quantity_calc"`
	} `json:"inputs"`
}

type dayReport struct {
	ReportID    *int64    `json:"report_id"`
	Day         string    `json:"day"`
	Status      string    `json:"status"`
	MonthStatus string    `json:"month_status"`
	ReadOnly    bool      `json:"read_only"`
	TotalCents  int64     `json:"total_cents"`
	Rows        []dayLine `json:"rows"`
	Submission  *sub      `json:"submission"`
	Locked      *sub      `json:"locked"`
}

type monthDays struct {
	Status     string `json:"status"`
	Daily      bool   `json:"daily"`
	TotalCents int64  `json:"total_cents"`
	LastDay    string `json:"last_day"`
	Undated    *struct {
		Status     string `json:"status"`
		TotalCents int64  `json:"total_cents"`
	} `json:"undated"`
	Days []struct {
		Day        string `json:"day"`
		Status     string `json:"status"`
		TotalCents int64  `json:"total_cents"`
	} `json:"days"`
}

func (r dayReport) qty(product int64) int64 {
	for _, row := range r.Rows {
		if row.ID == product {
			var n int64
			for _, in := range row.Inputs {
				n += in.Quantity
			}
			return n
		}
	}
	return -1
}

func dailyEnv(t *testing.T) (*env, *http.Cookie, *http.Cookie, int64, int64) {
	e, clerk, boss, _ := submissionEnv(t)
	res, err := e.st.W.Exec("INSERT INTO products (name, price_cents, active, archived) VALUES ('Вінок', 25000, 1, 0)")
	if err != nil {
		t.Fatal(err)
	}
	p1, _ := res.LastInsertId()
	res, _ = e.st.W.Exec("INSERT INTO products (name, price_cents, active, archived) VALUES ('Свічка', 1000, 1, 0)")
	p2, _ := res.LastInsertId()
	for _, p := range []int64{p1, p2} {
		if _, err := e.st.W.Exec("INSERT INTO product_prices (product_id, period, price_cents) SELECT id, '2000-01', price_cents FROM products WHERE id = ?", p); err != nil {
			t.Fatal(err)
		}
	}
	return e, clerk, boss, p1, p2
}

func (e *env) dayJSON(c *http.Cookie, method, path, body string, want int) dayReport {
	e.t.Helper()
	w := e.do(method, path, body, nil, c)
	if w.Code != want {
		e.t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body)
	}
	var r dayReport
	json.Unmarshal(w.Body.Bytes(), &r)
	return r
}

func (e *env) monthDays(c *http.Cookie, path string) monthDays {
	e.t.Helper()
	w := e.do("GET", path, "", nil, c)
	if w.Code != 200 {
		e.t.Fatalf("GET %s: %d %s", path, w.Code, w.Body)
	}
	var m monthDays
	json.Unmarshal(w.Body.Bytes(), &m)
	return m
}

func qtyBody(action string, lines ...[3]int64) string {
	var parts []string
	for _, l := range lines {
		parts = append(parts, fmt.Sprintf(`{"product_id":%d,"price_cents":%d,"quantity":%d}`, l[0], l[1], l[2]))
	}
	return `{"action":"` + action + `","quantities":[` + strings.Join(parts, ",") + `]}`
}

// Days are saved and submitted one by one; the month is their sum and is submitted when every day is.
func TestDailyReportsSumIntoTheMonth(t *testing.T) {
	e, clerk, boss, p1, p2 := dailyEnv(t)
	base := "/api/v1/store/reports/2026-11/days/"

	d1 := e.dayJSON(clerk, "PUT", base+"2026-11-02", qtyBody("draft", [3]int64{p1, 25000, 2}, [3]int64{p2, 1000, 5}), 200)
	if d1.Status != "draft" || d1.TotalCents != 55000 || d1.ReadOnly || d1.ReportID == nil {
		t.Fatalf("day draft: %+v", d1)
	}
	rid := *d1.ReportID
	d2 := e.dayJSON(clerk, "PUT", base+"2026-11-03", qtyBody("submit", [3]int64{p1, 25000, 1}), 200)
	if d2.Status != "submitted" || !d2.ReadOnly || d2.Submission == nil || d2.Submission.By != "Оксана Мельник" || d2.MonthStatus != "draft" {
		t.Fatalf("day submit: %+v", d2)
	}
	// The month view is the sum of the days and is changed day by day only.
	month := e.dayJSON(clerk, "GET", "/api/v1/store/reports/2026-11", "", 200)
	if month.qty(p1) != 3 || month.qty(p2) != 5 || month.TotalCents != 80000 || !month.ReadOnly {
		t.Fatalf("month aggregate: %+v", month)
	}
	if w := e.do("PUT", "/api/v1/store/reports/2026-11", qtyBody("draft", [3]int64{p1, 25000, 9}), nil, clerk); w.Code != 409 {
		t.Fatalf("monthly save of a daily month: %d %s", w.Code, w.Body)
	}
	// A submitted day is locked; a reviewer unlocks it.
	if w := e.do("PUT", base+"2026-11-03", qtyBody("draft", [3]int64{p1, 25000, 4}), nil, clerk); w.Code != 409 {
		t.Fatalf("save of a submitted day: %d", w.Code)
	}
	days := e.monthDays(clerk, "/api/v1/store/reports/2026-11/days")
	if !days.Daily || days.Undated != nil || len(days.Days) != 2 || days.Days[0].Day != "2026-11-02" || days.Days[1].Status != "submitted" ||
		days.TotalCents != 80000 || days.LastDay != "2026-11-06" {
		t.Fatalf("days: %+v", days)
	}
	// Days in the future, outside the month or not in the calendar are refused.
	for path, code := range map[string]int{base + "2026-11-07": 422, base + "2026-10-30": 400, base + "2026-11-31": 400, base + "x": 400} {
		if w := e.do("PUT", path, qtyBody("draft"), nil, clerk); w.Code != code {
			t.Fatalf("%s: %d, want %d (%s)", path, w.Code, code, w.Body)
		}
	}

	// The reviewer: one day of the register, one day of the matrix, the day detail, lock and unlock.
	var reg []struct {
		Status     string `json:"status"`
		TotalCents int64  `json:"total_cents"`
	}
	json.Unmarshal(e.do("GET", "/api/v1/admin/daily-reports?day=2026-11-03", "", nil, boss).Body.Bytes(), &reg)
	if len(reg) != 1 || reg[0].Status != "submitted" || reg[0].TotalCents != 25000 {
		t.Fatalf("daily register: %+v", reg)
	}
	var sum struct {
		Day   string `json:"day"`
		Grand int64  `json:"grand_total_cents"`
	}
	json.Unmarshal(e.do("GET", "/api/v1/admin/summary?day=2026-11-02", "", nil, boss).Body.Bytes(), &sum)
	if sum.Day != "2026-11-02" || sum.Grand != 55000 {
		t.Fatalf("day summary: %+v", sum)
	}
	json.Unmarshal(e.do("GET", "/api/v1/admin/summary?period=2026-11&submitted_only=true", "", nil, boss).Body.Bytes(), &sum)
	if sum.Grand != 25000 {
		t.Fatalf("submitted only counts submitted days: %+v", sum)
	}
	adminPath := fmt.Sprintf("/api/v1/admin/reports/%d/days/", rid)
	if d := e.dayJSON(boss, "GET", adminPath+"2026-11-02", "", 200); d.qty(p2) != 5 || d.Status != "draft" {
		t.Fatalf("admin day: %+v", d)
	}
	locked := e.dayJSON(boss, "PATCH", adminPath+"2026-11-02", `{"status":"submitted"}`, 200)
	if locked.Status != "submitted" || locked.Locked == nil || locked.Locked.By != "boss" || locked.MonthStatus != "submitted" {
		t.Fatalf("lock day: %+v", locked)
	}
	if d := e.dayJSON(boss, "PATCH", adminPath+"2026-11-03", `{"status":"draft"}`, 200); d.Status != "draft" || d.MonthStatus != "draft" {
		t.Fatalf("unlock day: %+v", d)
	}
	if d := e.dayJSON(clerk, "PUT", base+"2026-11-03", qtyBody("draft", [3]int64{p1, 25000, 4}), 200); d.qty(p1) != 4 {
		t.Fatalf("edit after unlock: %+v", d)
	}
	if m := e.dayJSON(clerk, "GET", "/api/v1/store/reports/2026-11", "", 200); m.qty(p1) != 6 {
		t.Fatalf("aggregate after edit: %d", m.qty(p1))
	}
	// Locking the whole month locks every day.
	if w := e.do("PATCH", fmt.Sprintf("/api/v1/admin/reports/%d", rid), `{"status":"submitted"}`, nil, boss); w.Code != 200 {
		t.Fatalf("lock month: %d", w.Code)
	}
	if days := e.monthDays(boss, fmt.Sprintf("/api/v1/admin/reports/%d/days", rid)); days.Status != "submitted" || days.Days[1].Status != "submitted" {
		t.Fatalf("month lock: %+v", days)
	}
	// Saving a day is recorded in the reviewer's notifications only on submit.
	var n int
	e.st.R.QueryRow("SELECT COUNT(*) FROM notifications WHERE kind = 'report.day_submitted'").Scan(&n)
	if n != 1 {
		t.Fatalf("day notifications: %d", n)
	}
}

// A month entered as a whole before daily reports keeps its quantities: they become the undated part.
func TestMonthlyQuantitiesSurviveTheSwitchToDays(t *testing.T) {
	e, clerk, boss, p1, p2 := dailyEnv(t)
	e.dayJSON(clerk, "PUT", "/api/v1/store/reports/2026-11", qtyBody("draft", [3]int64{p1, 25000, 3}, [3]int64{p2, 1000, 2}), 200)
	before := e.monthDays(clerk, "/api/v1/store/reports/2026-11/days")
	if before.Daily || before.Undated == nil || before.Undated.TotalCents != 77000 {
		t.Fatalf("legacy month: %+v", before)
	}
	// An inactive product's row is kept too.
	e.st.W.Exec("UPDATE products SET active = 0 WHERE id = ?", p2)

	e.dayJSON(clerk, "PUT", "/api/v1/store/reports/2026-11/days/2026-11-05", qtyBody("draft", [3]int64{p1, 25000, 1}), 200)
	after := e.monthDays(clerk, "/api/v1/store/reports/2026-11/days")
	if !after.Daily || after.Undated == nil || after.Undated.TotalCents != 77000 || len(after.Days) != 1 || after.TotalCents != 102000 {
		t.Fatalf("after the first day: %+v", after)
	}
	month := e.dayJSON(boss, "GET", "/api/v1/admin/reports/"+itoa(int(*e.dayJSON(clerk, "GET", "/api/v1/store/reports/2026-11", "", 200).ReportID)), "", 200)
	if month.TotalCents != 102000 {
		t.Fatalf("month total: %+v", month)
	}
	// The undated part stays editable as its own "day" until it is submitted.
	u := e.dayJSON(clerk, "PUT", "/api/v1/store/reports/2026-11/days/undated", qtyBody("submit", [3]int64{p1, 25000, 2}), 200)
	if u.Day != "undated" || u.Status != "submitted" || u.qty(p1) != 2 {
		t.Fatalf("undated: %+v", u)
	}
	var items int64
	e.st.R.QueryRow("SELECT COALESCE(SUM(quantity), 0) FROM report_items WHERE product_id = ?", p2).Scan(&items)
	if items != 2 {
		t.Fatalf("the inactive product's quantity must stay: %d", items)
	}
	var sum struct {
		Grand int64 `json:"grand_total_cents"`
	}
	json.Unmarshal(e.do("GET", "/api/v1/admin/summary?period=2026-11", "", nil, boss).Body.Bytes(), &sum)
	if sum.Grand != 77000 { // 2 + 1 wreaths, 2 candles
		t.Fatalf("summary after the edit: %d", sum.Grand)
	}
}

// A month submitted as a whole takes no days until a reviewer unlocks it; a store without a month gets no undated part.
func TestSubmittedMonthBlocksDays(t *testing.T) {
	e, clerk, _, p1, _ := dailyEnv(t)
	if w := e.do("PUT", "/api/v1/store/reports/2026-11/days/undated", qtyBody("draft"), nil, clerk); w.Code != 404 {
		t.Fatalf("undated without data: %d", w.Code)
	}
	e.dayJSON(clerk, "PUT", "/api/v1/store/reports/2026-11", qtyBody("submit", [3]int64{p1, 25000, 1}), 200)
	if w := e.do("PUT", "/api/v1/store/reports/2026-11/days/2026-11-04", qtyBody("draft", [3]int64{p1, 25000, 1}), nil, clerk); w.Code != 409 {
		t.Fatalf("day of a submitted month: %d", w.Code)
	}
	if d := e.dayJSON(clerk, "GET", "/api/v1/store/reports/2026-11/days/2026-11-04", "", 200); !d.ReadOnly || d.Status != "new" {
		t.Fatalf("read of a day of a submitted month: %+v", d)
	}
}
