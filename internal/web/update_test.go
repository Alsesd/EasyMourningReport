package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"legkyi/internal/update"
)

func TestUpdateEndpointsWithoutAReleaseBuild(t *testing.T) {
	e := newEnv(t, nil)
	boss := sessionCookie(e.login("boss", "boss-pass"))
	w := e.do("GET", "/api/v1/admin/update", "", nil, boss)
	var st update.Status
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &st) != nil || st.Enabled {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	for _, path := range []string{"/api/v1/admin/update/check", "/api/v1/admin/update/apply"} {
		if w := e.do("POST", path, "{}", nil, boss); w.Code != 409 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
	if w := e.do("GET", "/api/v1/admin/update", "", nil); w.Code != 401 {
		t.Fatalf("anonymous: %d", w.Code)
	}
}

func TestUpdateApplyThroughTheAPI(t *testing.T) {
	built := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/alsesd/easymourningreport/releases/latest":
			json.NewEncoder(w).Encode(map[string]any{"tag_name": "auto-9", "target_commitish": "bbb", "published_at": built.Add(time.Hour),
				"assets": []map[string]any{
					{"name": "legkyi", "browser_download_url": "http://" + r.Host + "/dl/legkyi", "size": 3},
					{"name": "SHA256SUMS.txt", "browser_download_url": "http://" + r.Host + "/dl/sums", "size": 100},
				}})
		case "/dl/sums":
			// sha256("new")
			w.Write([]byte("11507a0e2f5e69d5dfa40a62a1bd7b6ee57e6bcd85c67c9b8431b36fff21c437  legkyi\n"))
		case "/dl/legkyi":
			w.Write([]byte("new"))
		}
	}))
	defer fake.Close()
	exe := filepath.Join(t.TempDir(), "legkyi")
	os.WriteFile(exe, []byte("old"), 0o755)
	restarted := make(chan struct{}, 1)
	u := &update.Updater{API: fake.URL, AllowHTTP: true, Exe: exe, GOOS: "linux", GOARCH: "amd64",
		Build: update.Build{Tag: "auto-8", Commit: "aaa", BuiltAt: built}, Restart: func() { restarted <- struct{}{} }}
	e := newEnv(t, func(d *Deps) { d.Updater = u })
	boss := sessionCookie(e.login("boss", "boss-pass"))

	var st update.Status
	w := e.do("POST", "/api/v1/admin/update/check", "{}", nil, boss)
	if json.Unmarshal(w.Body.Bytes(), &st) != nil || !st.Available || st.Latest != "auto-9" {
		t.Fatalf("check: %d %s", w.Code, w.Body)
	}
	if w := e.do("POST", "/api/v1/admin/update/apply", "{}", nil, boss); w.Code != 200 {
		t.Fatalf("apply: %d %s", w.Code, w.Body)
	}
	select {
	case <-restarted:
	default:
		t.Fatal("a restart must be requested")
	}
	if b, _ := os.ReadFile(exe); string(b) != "new" {
		t.Fatalf("program: %q", b)
	}
	var action string
	e.st.R.QueryRow("SELECT action FROM audit_log ORDER BY id DESC LIMIT 1").Scan(&action)
	if action != "оновлення програми" {
		t.Fatalf("audit: %q", action)
	}
}
