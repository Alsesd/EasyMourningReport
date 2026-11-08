package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
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
	ReportID     *int64    `json:"report_id"`
	Day          string    `json:"day"`
	Status       string    `json:"status"`
	MonthStatus  string    `json:"month_status"`
	ReadOnly     bool      `json:"read_only"`
	Closed       bool      `json:"closed"`
	Missed       bool      `json:"missed"`
	AutoLockedAt string    `json:"auto_locked_at"`
	TotalCents   int64     `json:"total_cents"`
	Rows         []dayLine `json:"rows"`
	Submission   *sub      `json:"submission"`
	Locked       *sub      `json:"locked"`
}

type monthDays struct {
	Status     string `json:"status"`
	Daily      bool   `json:"daily"`
	TotalCents int64  `json:"total_cents"`
	LastDay    string `json:"last_day"`
	Days       []struct {
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
	// The clock starts on 2 November; tests move it forward day by day (a past day without a report is closed).
	e.setDay("2026-11-02")
	clerk, boss = sessionCookie(e.login("clerk", "Clerk-pass1")), sessionCookie(e.login("boss", "Boss-pass1"))
	return e, clerk, boss, p1, p2
}

func (e *env) exec(q string, args ...any) int64 {
	e.t.Helper()
	res, err := e.st.W.Exec(q, args...)
	if err != nil {
		e.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

// setDay moves the test clock to 10:00 UTC of a date.
func (e *env) setDay(day string) {
	t, err := time.Parse("2006-01-02", day)
	if err != nil {
		e.t.Fatal(err)
	}
	e.now = t.Add(10 * time.Hour)
}

// closeDays runs the midnight close as the scheduler does, at 00:05 of a date.
func (e *env) closeDays(day string) {
	e.t.Helper()
	e.setDay(day)
	e.now = e.now.Add(-10*time.Hour + 5*time.Minute)
	if err := (&App{Deps: e.deps}).runDayClose(context.Background(), e.now); err != nil {
		e.t.Fatal(err)
	}
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
	e.setDay("2026-11-03")
	d2 := e.dayJSON(clerk, "PUT", base+"2026-11-03", qtyBody("submit", [3]int64{p1, 25000, 1}), 200)
	if d2.Status != "submitted" || !d2.ReadOnly || d2.Submission == nil || d2.Submission.By != "Оксана Мельник" || d2.MonthStatus != "draft" {
		t.Fatalf("day submit: %+v", d2)
	}
	// The month view is the sum of the days and is changed day by day only.
	monthPath := fmt.Sprintf("/api/v1/admin/reports/%d", rid)
	month := e.dayJSON(boss, "GET", monthPath, "", 200)
	if month.qty(p1) != 3 || month.qty(p2) != 5 || month.TotalCents != 80000 {
		t.Fatalf("month aggregate: %+v", month)
	}
	if w := e.do("PUT", "/api/v1/store/reports/2026-11", qtyBody("draft", [3]int64{p1, 25000, 9}), nil, clerk); w.Code != 404 {
		t.Fatalf("monthly save of a daily month: %d %s", w.Code, w.Body)
	}
	// A submitted day is locked; a reviewer unlocks it.
	if w := e.do("PUT", base+"2026-11-03", qtyBody("draft", [3]int64{p1, 25000, 4}), nil, clerk); w.Code != 409 {
		t.Fatalf("save of a submitted day: %d", w.Code)
	}
	e.setDay("2026-11-06")
	// A past day that has no report is closed; a past draft (not closed yet) is still open.
	if w := e.do("PUT", base+"2026-11-04", qtyBody("draft", [3]int64{p1, 25000, 1}), nil, clerk); w.Code != 409 {
		t.Fatalf("a past day without a report: %d", w.Code)
	}
	if d := e.dayJSON(clerk, "GET", base+"2026-11-04", "", 200); !d.Closed || !d.ReadOnly {
		t.Fatalf("closed day: %+v", d)
	}
	days := e.monthDays(clerk, "/api/v1/store/reports/2026-11/days")
	if len(days.Days) != 2 || days.Days[0].Day != "2026-11-02" || days.Days[1].Status != "submitted" ||
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
	// Locked by the reviewer, but the store never submitted it: it does not count, the month stays a draft.
	if locked.Status != "submitted" || locked.Locked == nil || locked.Locked.By != "boss" || locked.MonthStatus != "draft" {
		t.Fatalf("lock day: %+v", locked)
	}
	if d := e.dayJSON(boss, "PATCH", adminPath+"2026-11-03", `{"status":"draft"}`, 200); d.Status != "draft" || d.MonthStatus != "draft" {
		t.Fatalf("unlock day: %+v", d)
	}
	if d := e.dayJSON(clerk, "PUT", base+"2026-11-03", qtyBody("draft", [3]int64{p1, 25000, 4}), 200); d.qty(p1) != 4 {
		t.Fatalf("edit after unlock: %+v", d)
	}
	if m := e.dayJSON(boss, "GET", monthPath, "", 200); m.qty(p1) != 6 {
		t.Fatalf("aggregate after edit: %d", m.qty(p1))
	}
	// The month of a daily report is only reviewed: it cannot be locked or unlocked as a whole.
	if w := e.do("PATCH", fmt.Sprintf("/api/v1/admin/reports/%d", rid), `{"status":"submitted"}`, nil, boss); w.Code != 405 {
		t.Fatalf("month lock of a daily month: %d", w.Code)
	}
	if days := e.monthDays(boss, fmt.Sprintf("/api/v1/admin/reports/%d/days", rid)); days.Status != "draft" || days.Days[1].Status != "draft" {
		t.Fatalf("the month PATCH must change nothing: %+v", days)
	}
	// Saving a day is recorded in the reviewer's notifications only on submit.
	var n int
	e.st.R.QueryRow("SELECT COUNT(*) FROM notifications WHERE kind = 'report.day_submitted'").Scan(&n)
	if n != 1 {
		t.Fatalf("day notifications: %d", n)
	}
}

// At midnight every open day is closed: a draft is locked as it is and a store without a report gets an empty
// locked day; both are marked missed and the reviewers are told. A late submission after an unlock stays marked.
func TestMidnightCloseLocksAndRecordsMissedDays(t *testing.T) {
	e, clerk, boss, p1, _ := dailyEnv(t)
	orgB := e.exec("INSERT INTO organisations (name, archived) VALUES ('Філія Б', 0)")
	e.addUser("clerk2", "", "Clerk2-pass1", &orgB, "organisation", "reports.submit")
	e.exec("INSERT INTO organisations (name, archived) VALUES ('Склад', 0)") // nobody fills in reports there
	e.closeDays("2026-11-02")                                                // the installation's first close: it only records yesterday, nobody is accused
	var anyMissed int
	e.st.R.QueryRow("SELECT COUNT(*) FROM report_days").Scan(&anyMissed)
	if anyMissed != 0 {
		t.Fatalf("the first close must close nothing: %d days", anyMissed)
	}
	e.setDay("2026-11-02")

	draft := e.dayJSON(clerk, "PUT", "/api/v1/store/reports/2026-11/days/2026-11-02", qtyBody("draft", [3]int64{p1, 25000, 2}), 200)
	rid := *draft.ReportID
	e.closeDays("2026-11-03")
	e.closeDays("2026-11-03") // a restart the same night changes nothing

	adminDay := fmt.Sprintf("/api/v1/admin/reports/%d/days/2026-11-02", rid)
	d := e.dayJSON(boss, "GET", adminDay, "", 200)
	if d.Status != "submitted" || !d.Missed || d.AutoLockedAt == "" || d.qty(p1) != 2 || d.Submission != nil {
		t.Fatalf("closed draft: %+v", d)
	}
	var reg []struct {
		StoreName string `json:"store_name"`
		Status    string `json:"status"`
		Missed    bool   `json:"missed"`
	}
	json.Unmarshal(e.do("GET", "/api/v1/admin/daily-reports?day=2026-11-02", "", nil, boss).Body.Bytes(), &reg)
	if len(reg) != 3 {
		t.Fatalf("register: %+v", reg)
	}
	for _, r := range reg {
		if r.StoreName == "Склад" && (r.Missed || r.Status != "none") {
			t.Fatalf("a store without reporting users is not checked: %+v", r)
		}
		if r.StoreName != "Склад" && (!r.Missed || r.Status != "submitted") {
			t.Fatalf("missed: %+v", r)
		}
	}
	var n int
	e.st.R.QueryRow("SELECT COUNT(*) FROM notifications WHERE kind = 'report.day_missed'").Scan(&n)
	if n != 1 {
		t.Fatalf("one notice per reviewer per close: %d", n)
	}
	var body string
	e.st.R.QueryRow("SELECT body FROM notifications WHERE kind = 'report.day_missed'").Scan(&body)
	if !strings.Contains(body, "Філія А · 02.11.2026") || !strings.Contains(body, "Філія Б · 02.11.2026") {
		t.Fatalf("notice body: %q", body)
	}

	// The store cannot change the closed day; the reviewer unlocks it and the store submits late.
	if w := e.do("PUT", "/api/v1/store/reports/2026-11/days/2026-11-02", qtyBody("submit", [3]int64{p1, 25000, 3}), nil, clerk); w.Code != 409 {
		t.Fatalf("closed day: %d", w.Code)
	}
	e.setDay("2026-11-03")
	e.dayJSON(boss, "PATCH", adminDay, `{"status":"draft"}`, 200)
	// A restart during the day (self-update, crash) runs the close again: the reopened day stays open.
	e.closeDays("2026-11-03")
	e.setDay("2026-11-03")
	late := e.dayJSON(clerk, "PUT", "/api/v1/store/reports/2026-11/days/2026-11-02", qtyBody("submit", [3]int64{p1, 25000, 3}), 200)
	if late.Status != "submitted" || !late.Missed || late.Submission == nil {
		t.Fatalf("late submission: %+v", late)
	}
	var missed []struct {
		StoreName string   `json:"store_name"`
		Days      []string `json:"days"`
		Late      []string `json:"late"`
	}
	json.Unmarshal(e.do("GET", "/api/v1/admin/missed-days?period=2026-11", "", nil, boss).Body.Bytes(), &missed)
	if len(missed) != 2 || missed[0].StoreName != "Філія А" || len(missed[0].Days) != 1 || len(missed[0].Late) != 1 || len(missed[1].Late) != 0 {
		t.Fatalf("missed list: %+v", missed)
	}

	// Store B's day is unlocked and left alone: the next midnight closes it again without a new notice about it.
	var ridB int64
	e.st.R.QueryRow("SELECT id FROM reports WHERE store_id = ?", orgB).Scan(&ridB)
	e.dayJSON(boss, "PATCH", fmt.Sprintf("/api/v1/admin/reports/%d/days/2026-11-02", ridB), `{"status":"draft"}`, 200)
	e.dayJSON(clerk, "PUT", "/api/v1/store/reports/2026-11/days/2026-11-03", qtyBody("submit", [3]int64{p1, 25000, 1}), 200)
	e.closeDays("2026-11-04")
	var status string
	e.st.R.QueryRow("SELECT status FROM report_days WHERE report_id = ? AND day = '2026-11-02'", ridB).Scan(&status)
	if status != "submitted" {
		t.Fatalf("an unlocked day closes again at midnight: %s", status)
	}
	var sub string
	e.st.R.QueryRow("SELECT body FROM notifications WHERE kind = 'report.day_missed' ORDER BY id DESC LIMIT 1").Scan(&sub)
	if strings.Contains(sub, "Філія А") || !strings.Contains(sub, "Філія Б · 03.11.2026") {
		t.Fatalf("second notice: %q", sub)
	}
}

// The first close ever closes nothing; later ones close each ended day once and catch up after a downtime.
func TestMidnightCloseCatchesUp(t *testing.T) {
	e, _, _, _, _ := dailyEnv(t)
	count := func() (n int) {
		e.st.R.QueryRow("SELECT COUNT(*) FROM report_days WHERE day != ''").Scan(&n)
		return
	}
	e.closeDays("2026-11-04") // first close: records 3 November, closes nothing
	if c := count(); c != 0 {
		t.Fatalf("first close: %d days", c)
	}
	e.closeDays("2026-11-05")
	if c := count(); c != 1 {
		t.Fatalf("next night: %d days", c)
	}
	e.closeDays("2026-11-09") // the program was off for three nights
	if c := count(); c != 5 {
		t.Fatalf("catch-up: %d days", c)
	}
}

// "Today" is the business zone's date (APP_TIMEZONE), not the machine's: at 22:30 UTC it is already tomorrow in Kyiv.
func TestStoreDaysFollowTheBusinessZone(t *testing.T) {
	kyiv, err := time.LoadLocation("Europe/Kyiv")
	if err != nil {
		t.Skip("no zone data")
	}
	e := newEnv(t, func(d *Deps) { d.Zone = kyiv })
	org := e.exec("INSERT INTO organisations (name, archived) VALUES ('Філія А', 0)")
	e.addUser("clerk", "", "Clerk-pass1", &org, "organisation", "reports.submit")
	e.now = time.Date(2026, 11, 6, 22, 30, 0, 0, time.UTC)
	clerk := sessionCookie(e.login("clerk", "Clerk-pass1"))
	if d := e.monthDays(clerk, "/api/v1/store/reports/2026-11/days"); d.LastDay != "2026-11-07" {
		t.Fatalf("today in Kyiv: %+v", d)
	}
}

// Two employees of one store share the day: both see it, and a save based on an older revision is refused
// instead of overwriting (or doubling) the colleague's numbers.
func TestColleaguesShareTheDayWithoutOverwriting(t *testing.T) {
	e, clerk, boss, p1, _ := dailyEnv(t)
	var orgID int64
	e.st.R.QueryRow("SELECT MIN(id) FROM organisations").Scan(&orgID)
	e.addUser("clerk2", "Іван Коваль", "Clerk2-pass1", &orgID, "organisation", "reports.submit")
	clerk2 := sessionCookie(e.login("clerk2", "Clerk2-pass1"))
	path := "/api/v1/store/reports/2026-11/days/2026-11-02"
	withRev := func(action string, rev int64, qty int64) string {
		return fmt.Sprintf(`{"action":"%s","revision":%d,"quantities":[{"product_id":%d,"price_cents":25000,"quantity":%d}]}`, action, rev, p1, qty)
	}
	type revDay struct {
		Revision int64 `json:"revision"`
		Saved    *sub  `json:"saved"`
	}
	read := func(c *http.Cookie) revDay {
		var r revDay
		json.Unmarshal(e.do("GET", path, "", nil, c).Body.Bytes(), &r)
		return r
	}
	// Both open the empty day (revision 0); the first one saves.
	r0 := e.dayJSON(clerk, "PUT", path, withRev("draft", 0, 2), 200)
	// The colleague still holds revision 0: refused, naming who changed it.
	w := e.do("PUT", path, withRev("draft", 0, 3), nil, clerk2)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "Оксана Мельник") {
		t.Fatalf("stale save: %d %s", w.Code, w.Body)
	}
	// After reloading, the colleague sees the first employee's draft and who saved it, and may save on top.
	r := read(clerk2)
	if r.Revision == 0 || r.Saved == nil || r.Saved.By != "Оксана Мельник" {
		t.Fatalf("shared draft: %+v", r)
	}
	if d := e.dayJSON(clerk2, "PUT", path, withRev("draft", r.Revision, 3), 200); d.qty(p1) != 3 {
		t.Fatalf("save on the latest revision: %+v", d)
	}
	// A save replaces the day's quantities, it never adds them up: the month holds 3, not 5.
	if m := e.dayJSON(boss, "GET", fmt.Sprintf("/api/v1/admin/reports/%d", *r0.ReportID), "", 200); m.qty(p1) != 3 {
		t.Fatalf("month: %d", m.qty(p1))
	}
	if r := read(clerk); r.Saved == nil || r.Saved.By != "Іван Коваль" {
		t.Fatalf("last saved by: %+v", r)
	}
}

// An empty day cannot be submitted (there are no days off): at least one quantity is needed; a draft may be empty.
func TestEmptyDayCannotBeSubmitted(t *testing.T) {
	e, clerk, _, p1, _ := dailyEnv(t)
	path := "/api/v1/store/reports/2026-11/days/2026-11-02"
	w := e.do("PUT", path, qtyBody("submit", [3]int64{p1, 25000, 0}), nil, clerk)
	if w.Code != 422 || !strings.Contains(w.Body.String(), "Порожній звіт") {
		t.Fatalf("empty submit: %d %s", w.Code, w.Body)
	}
	var n int
	e.st.R.QueryRow("SELECT COUNT(*) FROM report_days").Scan(&n)
	if n != 0 {
		t.Fatalf("a refused submit must leave nothing behind: %d days", n)
	}
	if d := e.dayJSON(clerk, "PUT", path, qtyBody("draft"), 200); d.Status != "draft" {
		t.Fatalf("an empty draft is fine: %+v", d)
	}
	if d := e.dayJSON(clerk, "PUT", path, qtyBody("submit", [3]int64{p1, 25000, 1}), 200); d.Status != "submitted" {
		t.Fatalf("submit with a quantity: %+v", d)
	}
}

// Only days the store submitted count: a day closed at midnight stays out of the submitted figures and keeps the
// month a draft, until the store submits it (after a reviewer unlocks it).
func TestOnlyStoreSubmittedDaysCount(t *testing.T) {
	e, clerk, boss, p1, _ := dailyEnv(t)
	e.closeDays("2026-11-02") // first close: records only
	e.setDay("2026-11-02")
	d := e.dayJSON(clerk, "PUT", "/api/v1/store/reports/2026-11/days/2026-11-02", qtyBody("draft", [3]int64{p1, 25000, 2}), 200)
	e.closeDays("2026-11-03")
	submitted := func() int64 {
		var s struct {
			Grand int64 `json:"grand_total_cents"`
		}
		json.Unmarshal(e.do("GET", "/api/v1/admin/summary?period=2026-11&submitted_only=true", "", nil, boss).Body.Bytes(), &s)
		return s.Grand
	}
	if g := submitted(); g != 0 {
		t.Fatalf("a day closed at midnight must not count as submitted: %d", g)
	}
	path := fmt.Sprintf("/api/v1/admin/reports/%d/days/2026-11-02", *d.ReportID)
	if m := e.monthDays(boss, fmt.Sprintf("/api/v1/admin/reports/%d/days", *d.ReportID)); m.Status != "draft" {
		t.Fatalf("month with an unsubmitted day: %+v", m)
	}
	e.setDay("2026-11-03")
	e.dayJSON(boss, "PATCH", path, `{"status":"draft"}`, 200)
	e.dayJSON(clerk, "PUT", "/api/v1/store/reports/2026-11/days/2026-11-02", qtyBody("submit", [3]int64{p1, 25000, 2}), 200)
	if g := submitted(); g != 50000 {
		t.Fatalf("after the late submission: %d", g)
	}
}
