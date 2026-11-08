package web

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"legkyi/internal/platform"
	"legkyi/internal/registry"
)

type bell struct {
	Unread int `json:"unread"`
	Items  []struct {
		ID           int64
		Kind, Title  string
		Body, Link   string
		Read         bool
		CreatedAtStr string `json:"created_at"`
	} `json:"items"`
}

func (d *desks) bell(c *http.Cookie) bell {
	d.e.t.Helper()
	w := d.e.do("GET", "/api/v1/notifications", "", nil, c)
	if w.Code != 200 {
		d.e.t.Fatalf("bell: %d %s", w.Code, w.Body)
	}
	var b bell
	json.Unmarshal(w.Body.Bytes(), &b)
	return b
}

func (b bell) kinds() string {
	var k []string
	for _, i := range b.Items {
		k = append(k, i.Kind)
	}
	return strings.Join(k, ",")
}

func TestTransportEventsReachTheRightPeople(t *testing.T) {
	d := newDesks(t)
	d.e.addUser("disp", "Диспетчер", "Disp-pass1", nil, "platform", "transport.orders.manage")
	disp := sessionCookie(d.e.login("disp", "Disp-pass1"))

	o := d.create(d.a, order(day, "Іваненко І. І.", "d09:30"))
	// The dispatcher hears of the new order; the author and the other desk do not.
	if b := d.bell(disp); b.Unread != 1 || b.Items[0].Kind != "transport.new" || !strings.Contains(b.Items[0].Body, "Філія А") || b.Items[0].Link != "/admin/transport" {
		t.Fatalf("dispatcher: %+v", b)
	}
	if d.bell(d.a).Unread != 0 || d.bell(d.b).Unread != 0 || d.bell(d.view).Unread != 0 {
		t.Fatal("only dispatchers (manage) are told about a new order")
	}
	// The dispatcher's reply reaches the author, and only the author.
	d.post(disp, "POST", "/api/v1/transport/orders/"+itoa(int(o.ID))+"/status", map[string]any{"status": "accepted", "note": "Виїде о 8:40"})
	b := d.bell(d.a)
	if b.Unread != 1 || b.Items[0].Kind != "transport.status" || !strings.Contains(b.Items[0].Title, "прийнято") || !strings.Contains(b.Items[0].Body, "Виїде о 8:40") {
		t.Fatalf("author: %+v", b)
	}
	if d.bell(d.b).Unread != 0 {
		t.Fatal("another desk must not hear about it")
	}
	// A desk's cancel goes to the dispatchers.
	o2 := d.create(d.a, order(day, "Петренко П. П.", "d15:30"))
	d.post(d.a, "POST", "/api/v1/transport/orders/"+itoa(int(o2.ID))+"/cancel", nil)
	if got := d.bell(disp).kinds(); got != "transport.cancelled,transport.new,transport.new" {
		t.Fatalf("dispatcher kinds: %s", got)
	}
}

func TestBumpedDeskAndMilitaryOrderNotifications(t *testing.T) {
	d := newDesks(t)
	d.e.addUser("disp", "Диспетчер", "Disp-pass1", nil, "platform", "transport.orders.manage")
	disp := sessionCookie(d.e.login("disp", "Disp-pass1"))
	civil := d.create(d.a, sameCarOrder("Цивільний", "АА 5555 АА", "d10:00"))
	mil := sameCarOrder("Військовий", "АА 5555 АА", "d11:00")
	mil["military"] = true
	d.create(d.b, mil)
	a := d.bell(d.a)
	if a.Unread != 1 || a.Items[0].Kind != "transport.bumped" || !strings.Contains(a.Items[0].Body, "військовому") {
		t.Fatalf("desk of the bumped order: %+v", a)
	}
	if b := d.bell(disp); b.Unread != 2 || !strings.Contains(b.Items[0].Title, "ВІЙСЬКОВЕ") {
		t.Fatalf("dispatcher: %+v", b)
	}
	// Sending the bumped order again (new time) tells the dispatchers.
	d.post(d.a, "PUT", "/api/v1/transport/orders/"+itoa(int(civil.ID)), sameCarOrder("Цивільний", "АА 5555 АА", "d14:00"))
	if b := d.bell(disp); b.Unread != 3 || b.Items[0].Title != "Замовлення надіслано знову" {
		t.Fatalf("resubmitted: %+v", b)
	}
}

func TestNotificationsAreReadAndMarkedOnlyByTheirOwner(t *testing.T) {
	d := newDesks(t)
	d.e.addUser("disp", "Диспетчер", "Disp-pass1", nil, "platform", "transport.orders.manage")
	disp := sessionCookie(d.e.login("disp", "Disp-pass1"))
	d.create(d.a, order(day, "Один", "d08:00"))
	d.create(d.a, order(day, "Два", "d12:00"))
	b := d.bell(disp)
	if b.Unread != 2 {
		t.Fatalf("%+v", b)
	}
	// Someone else cannot mark it.
	d.e.do("POST", "/api/v1/notifications/"+itoa(int(b.Items[0].ID))+"/read", "{}", nil, d.b)
	if d.bell(disp).Unread != 2 {
		t.Fatal("a foreign mark-read changed the row")
	}
	w := d.e.do("POST", "/api/v1/notifications/"+itoa(int(b.Items[0].ID))+"/read", "{}", nil, disp)
	var after bell
	json.Unmarshal(w.Body.Bytes(), &after)
	if w.Code != 200 || after.Unread != 1 {
		t.Fatalf("%d %+v", w.Code, after)
	}
	d.e.do("POST", "/api/v1/notifications/read-all", "{}", nil, disp)
	if d.bell(disp).Unread != 0 {
		t.Fatal("read-all")
	}
	if w := d.e.do("GET", "/api/v1/notifications", "", nil); w.Code != 401 {
		t.Fatalf("anonymous: %d", w.Code)
	}
}

func TestSubmittedReportNotifiesReviewers(t *testing.T) {
	e := newEnv(t, nil)
	seedDemo(t, e)
	s1 := e.as("store1", "Store1-demo")
	s1.json("PUT", "/api/v1/store/reports/2026-11/days/2026-11-06", `{"action":"draft","quantities":[]}`, 200)
	boss := e.as("boss", "Boss-pass1")
	var b bell
	json.Unmarshal(boss.do("GET", "/api/v1/notifications", "").Body.Bytes(), &b)
	if b.Unread != 0 {
		t.Fatalf("a draft must not notify: %+v", b)
	}
	s1.json("PUT", "/api/v1/store/reports/2026-11/days/2026-11-06", `{"action":"submit","quantities":[{"product_id":1,"price_cents":250,"quantity":1}]}`, 200)
	json.Unmarshal(boss.do("GET", "/api/v1/notifications", "").Body.Bytes(), &b)
	if b.Unread != 1 || b.Items[0].Kind != "report.day_submitted" || !strings.HasPrefix(b.Items[0].Link, "/admin/reports/") {
		t.Fatalf("%+v", b)
	}
}

func TestReminderForDesksWithoutAnOrderForTomorrow(t *testing.T) {
	d := newDesks(t)
	a := &App{Deps: Deps{Store: d.e.st, Registry: registry.Installed(), Now: func() time.Time { return d.e.now }}}
	kyiv, err := time.LoadLocation("Europe/Kyiv")
	if err != nil {
		t.Skip("no tzdata on this machine")
	}
	now := time.Date(2026, 11, 6, 14, 30, 0, 0, kyiv)
	// Desk A has an order for tomorrow, desk B has none, desk B's cancelled one does not count.
	tomorrow := order("2026-11-07", "Завтрашній", "d09:00")
	d.create(d.a, tomorrow)
	cancelled := d.create(d.b, order("2026-11-07", "Скасований", "d09:00"))
	d.post(d.b, "POST", "/api/v1/transport/orders/"+itoa(int(cancelled.ID))+"/cancel", nil)
	for i := 0; i < 3; i++ { // evaluated again (restart, retry): still one reminder
		if err := a.runDailyReminders(context.Background(), now); err != nil {
			t.Fatal(err)
		}
	}
	if b := d.bell(d.b); b.Unread != 1 || b.Items[0].Kind != "transport.reminder" ||
		!strings.Contains(b.Items[0].Body, "14:30") || !strings.Contains(b.Items[0].Body, "07.11.2026") || !strings.Contains(b.Items[0].Body, "Філія Б") {
		t.Fatalf("desk without an order: %+v", b)
	}
	if b := d.bell(d.a); b.Unread != 0 {
		t.Fatalf("desk with an order must not be reminded: %+v", b)
	}
	if b := d.bell(d.boss); strings.Contains(b.kinds(), "transport.reminder") {
		t.Fatalf("staff are not desks: %+v", b)
	}
	// Next day, the same desk is reminded again (a new dedupe key).
	if err := a.runDailyReminders(context.Background(), now.AddDate(0, 0, 1)); err != nil {
		t.Fatal(err)
	}
	if b := d.bell(d.b); b.Unread != 2 {
		t.Fatalf("next day: %+v", b)
	}
}

func TestParseClockAndPruning(t *testing.T) {
	if m, ok := parseClock("14:30"); !ok || m != 14*60+30 {
		t.Fatalf("%d %v", m, ok)
	}
	for _, bad := range []string{"", "off", "24:00", "9:30", "14:60"} {
		if _, ok := parseClock(bad); ok {
			t.Fatalf("%q must not parse", bad)
		}
	}
	d := newDesks(t)
	old := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	d.e.st.W.Exec(`INSERT INTO notifications (user_id, kind, title, created_at, read_at) VALUES (1, 'x', 'read old', ?, ?)`, old.Unix(), old.Unix())
	d.e.st.W.Exec(`INSERT INTO notifications (user_id, kind, title, created_at) VALUES (1, 'x', 'unread ancient', ?)`, old.Unix())
	d.e.st.W.Exec(`INSERT INTO notifications (user_id, kind, title, created_at) VALUES (1, 'x', 'unread old', ?)`, d.e.now.AddDate(0, 0, -100).Unix())
	d.e.st.W.Exec(`INSERT INTO notifications (user_id, kind, title, created_at) VALUES (1, 'x', 'fresh', ?)`, d.e.now.Unix())
	a := &App{Deps: Deps{Store: d.e.st, Registry: registry.Installed(), Now: func() time.Time { return d.e.now }}}
	if err := a.write(context.Background(), func(tx *sql.Tx) error {
		return platform.PruneNotifications(tx, d.e.now, 30*24*time.Hour, 180*24*time.Hour)
	}); err != nil {
		t.Fatal(err)
	}
	if n := count(d.e, "SELECT COUNT(*) FROM notifications WHERE title = 'fresh'"); n != 1 {
		t.Fatal("fresh row pruned")
	}
	if n := count(d.e, "SELECT COUNT(*) FROM notifications WHERE title = 'read old'"); n != 0 {
		t.Fatal("old read row kept")
	}
	if n := count(d.e, "SELECT COUNT(*) FROM notifications WHERE title = 'unread old'"); n != 1 { // unread, 100 days: inside the 180-day limit
		t.Fatal("an unread row inside the long limit was pruned")
	}
	if n := count(d.e, "SELECT COUNT(*) FROM notifications WHERE title = 'unread ancient'"); n != 0 {
		t.Fatal("a row past the long limit was kept")
	}
}

func TestTestNotificationReachesOnlyTheCaller(t *testing.T) {
	d := newDesks(t)
	post := func(c *http.Cookie) *httptest.ResponseRecorder { return d.post(c, "POST", "/api/v1/notifications/test", map[string]any{}) }
	if w := d.e.do("POST", "/api/v1/notifications/test", "{}", nil); w.Code != 401 {
		t.Fatalf("signed in only: %d", w.Code)
	}
	w := post(d.a)
	var out struct {
		PushConfigured bool `json:"push_configured"`
		Devices        int  `json:"devices"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil || out.PushConfigured || out.Devices != 0 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	post(d.a) // the same minute: not a second one
	count := func(c *http.Cookie) int {
		var l struct{ Items []struct{ Kind string } }
		json.Unmarshal(d.e.do("GET", "/api/v1/notifications", "", nil, c).Body.Bytes(), &l)
		n := 0
		for _, i := range l.Items {
			if i.Kind == "test" {
				n++
			}
		}
		return n
	}
	if count(d.a) != 1 || count(d.b) != 0 {
		t.Fatalf("one test notification, for the caller only: %d / %d", count(d.a), count(d.b))
	}
}
