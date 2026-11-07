package web

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"legkyi/internal/system"
)

func TestMetricsAreForAdministratorsAndIntegrityIsCached(t *testing.T) {
	d := newDesks(t)
	if w := d.e.do("GET", "/api/v1/admin/system/metrics", "", nil, d.a); w.Code != 403 {
		t.Fatalf("a desk must not read the metrics: %d", w.Code)
	}
	get := func() map[string]any {
		w := d.e.do("GET", "/api/v1/admin/system/metrics", "", nil, d.boss)
		if w.Code != 200 {
			t.Fatalf("metrics: %d %s", w.Code, w.Body)
		}
		var m map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	m := get()
	for _, k := range []string{"build", "runtime", "db", "integrity", "disk", "backups", "jobs", "push", "sessions", "http"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("missing %q in %v", k, m)
		}
	}
	first := m["integrity"].(map[string]any)
	if first["ok"] != true {
		t.Fatalf("integrity: %v", first)
	}
	tables := m["db"].(map[string]any)["tables"].(map[string]any)
	if tables["users"].(float64) < 4 {
		t.Fatalf("table counts: %v", tables)
	}
	if again := get()["integrity"].(map[string]any); again["checked_at"] != first["checked_at"] {
		t.Fatalf("a second call must reuse the verdict: %v vs %v", again, first)
	}
	w := d.post(d.boss, "POST", "/api/v1/admin/system/integrity-check", map[string]any{})
	if w.Code != 200 {
		t.Fatalf("recheck: %d %s", w.Code, w.Body)
	}
	if w := d.post(d.a, "POST", "/api/v1/admin/system/integrity-check", map[string]any{}); w.Code != 403 {
		t.Fatalf("a desk must not force a check: %d", w.Code)
	}
}

func TestMetricsCountClientAndServerErrorsApart(t *testing.T) {
	d := newDesks(t)
	read := func() (client, server float64) {
		w := d.e.do("GET", "/api/v1/admin/system/metrics", "", nil, d.boss)
		var m struct {
			HTTP struct {
				Client float64 `json:"client_errors"`
				Server float64 `json:"server_errors"`
			} `json:"http"`
		}
		json.Unmarshal(w.Body.Bytes(), &m)
		return m.HTTP.Client, m.HTTP.Server
	}
	c0, s0 := read()
	d.e.do("GET", "/api/v1/no-such-route", "", nil, d.boss)
	c1, s1 := read()
	if c1 != c0+1 || s1 != s0 {
		t.Fatalf("a missing page is a client refusal, not a fault: client %v->%v server %v->%v", c0, c1, s0, s1)
	}
}

func withLogRing(t *testing.T) *system.LogRing {
	t.Helper()
	ring := system.NewLogRing(nil, 50)
	log.SetOutput(ring)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return ring
}

func TestServerFaultsAreLoggedWithTheirRequest(t *testing.T) {
	ring := withLogRing(t)
	a := &App{}
	do := func(err error) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		a.done(w, httptest.NewRequest("GET", "/api/v1/boom?token=SECRET", nil), err)
		return w
	}
	if w := do(errors.New("db exploded")); w.Code != 500 {
		t.Fatalf("a plain error is a 500: %d", w.Code)
	}
	do(HTTPError{Status: 500, Detail: "Не вдалося створити резервну копію"})
	do(HTTPError{Status: 404, Detail: "немає"}) // a refusal is not a fault
	got := ring.Recent("", 10)
	if len(got) != 2 || got[1].Message != "server error: GET /api/v1/boom: db exploded" {
		t.Fatalf("method, path (no query) and cause: %+v", got)
	}
	if !strings.Contains(got[0].Message, "Не вдалося створити резервну копію") || strings.Contains(got[0].Message+got[1].Message, "SECRET") {
		t.Fatalf("an HTTPError 500 is logged too, and the query string never is: %+v", got)
	}
}

func TestAPanicBecomesALogged500AndIsCounted(t *testing.T) {
	ring := withLogRing(t)
	m := &httpMetrics{}
	h := m.counted(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic("kaboom") }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/things", nil))
	if w.Code != 500 || m.server.Load() != 1 {
		t.Fatalf("answered %d, counted %d", w.Code, m.server.Load())
	}
	if m.last5xx == nil || !strings.Contains(m.last5xx.Message, "kaboom") || m.last5xx.Path != "/api/v1/things" {
		t.Fatalf("the cause reaches the counter: %+v", m.last5xx)
	}
	if got := ring.Recent("error", 5); len(got) != 1 || !strings.Contains(got[0].Message, "panic serving POST /api/v1/things: kaboom") {
		t.Fatalf("the panic is logged with its place: %+v", got)
	}
	// The cause of a handler's error (set by done) reaches last_server_error as well.
	h2 := m.counted(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		(&App{}).done(w, r, errors.New("disk is full"))
	}))
	h2.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/api/v1/x", nil))
	if m.last5xx.Message != "disk is full" || m.server.Load() != 2 {
		t.Fatalf("%+v", m.last5xx)
	}
}

func TestLogsPageIsForAdministratorsAndShowsTheCause(t *testing.T) {
	ring := withLogRing(t)
	d := newDesksWith(t, func(dd *Deps) { dd.Logs = ring })
	log.Printf("backup failed: disk full")
	if w := d.e.do("GET", "/api/v1/admin/system/logs", "", nil, d.a); w.Code != 403 {
		t.Fatalf("a desk must not read the log: %d", w.Code)
	}
	w := d.e.do("GET", "/api/v1/admin/system/logs?level=error", "", nil, d.boss)
	var out struct {
		Entries []struct{ Level, Message string } `json:"entries"`
		Errors  int                               `json:"errors_24h"`
	}
	if json.Unmarshal(w.Body.Bytes(), &out) != nil || w.Code != 200 || len(out.Entries) != 1 || out.Entries[0].Message != "backup failed: disk full" || out.Errors != 1 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := d.e.do("GET", "/api/v1/admin/system/logs?level=nope", "", nil, d.boss); w.Code != 400 {
		t.Fatalf("a bad level: %d", w.Code)
	}
}
