package web

import (
	"encoding/json"
	"testing"
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
