package web

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"legkyi/internal/platform"
	"legkyi/internal/store"
	"legkyi/internal/system"
)

func withBackups(t *testing.T) (*store.Backups, func(*Deps)) {
	t.Helper()
	bk := &store.Backups{Dir: filepath.Join(t.TempDir(), "backups"), Keep: 50}
	return bk, func(d *Deps) {
		bk.Store = d.Store
		d.Backups = bk
		d.BackupEveryMin = 60
	}
}

func fakeTunnel(t *testing.T, script string) *system.Tunnel {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("sh scripts")
	}
	root := t.TempDir()
	env := map[string]string{}
	if script != "" {
		bin := filepath.Join(root, "cloudflared")
		os.WriteFile(bin, []byte(script), 0o755)
		env["CLOUDFLARED_PATH"] = bin
	}
	tun := &system.Tunnel{Root: root, Getenv: func(k string) string { return env[k] }, MetricsAddr: "127.0.0.1:1",
		LookPath: func(string) (string, error) { return "", os.ErrNotExist }}
	t.Cleanup(tun.Shutdown)
	return tun
}

func TestTunnelEndpoints(t *testing.T) {
	tun := fakeTunnel(t, "#!/bin/sh\nexec sleep 30\n")
	e := newEnv(t, func(d *Deps) { d.Tunnel = tun })
	seedDemo(t, e)
	boss := e.as("boss", "boss-pass")

	if st := boss.json("GET", "/api/v1/admin/tunnel", "", 200); st["state"] != "disabled" {
		t.Fatalf("%v", st)
	}
	boss.json("POST", "/api/v1/admin/tunnel", `{"confirm_public": false}`, 400)
	boss.json("POST", "/api/v1/admin/tunnel", `{}`, 422)
	boss.json("POST", "/api/v1/admin/tunnel", `{"confirm_public": true, "token": "`+strings.Repeat("x", 4097)+`"}`, 422)
	if n := count(e, "SELECT COUNT(*) FROM audit_log WHERE action LIKE '%публічний%'"); n != 0 {
		t.Fatalf("refusals must not be audited: %d", n)
	}

	w := boss.do("POST", "/api/v1/admin/tunnel", `{"confirm_public": true, "token": "tok-123", "autostart": false}`)
	if w.Code != 200 || strings.Contains(w.Body.String(), "tok-123") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var st map[string]any
	json.Unmarshal(w.Body.Bytes(), &st)
	if st["enabled"] != true || st["has_token"] != true || st["autostart"] != false {
		t.Fatalf("%v", st)
	}
	if n := count(e, "SELECT COUNT(*) FROM audit_log WHERE action = 'увімкнено публічний доступ' AND detail = 'новий токен'"); n != 1 {
		t.Fatalf("start audit: %d", n)
	}
	if st := boss.json("PUT", "/api/v1/admin/tunnel/autostart", `{"enabled": true}`, 200); st["autostart"] != true {
		t.Fatalf("%v", st)
	}
	boss.json("PUT", "/api/v1/admin/tunnel/autostart", `{}`, 422)
	if st := boss.json("DELETE", "/api/v1/admin/tunnel", "", 200); st["enabled"] != false || st["state"] != "stopped" {
		t.Fatalf("%v", st)
	}
	if n := count(e, "SELECT COUNT(*) FROM audit_log WHERE action = 'вимкнено публічний доступ'"); n != 1 {
		t.Fatalf("stop audit: %d", n)
	}

	s1 := e.as("store1", "store1")
	for _, c := range [][2]string{{"GET", "/api/v1/admin/tunnel"}, {"POST", "/api/v1/admin/tunnel"}, {"PUT", "/api/v1/admin/tunnel/autostart"},
		{"DELETE", "/api/v1/admin/tunnel"}, {"GET", "/api/v1/admin/backups"}, {"GET", "/api/v1/admin/system/health"}, {"GET", "/api/v1/admin/backup/download"}} {
		if w := s1.do(c[0], c[1], `{}`); w.Code != 403 {
			t.Errorf("%s %s: %d", c[0], c[1], w.Code)
		}
	}
}

func TestTunnelStartFailureIs503AndNotAudited(t *testing.T) {
	e := newEnv(t, func(d *Deps) { d.Tunnel = fakeTunnel(t, "") })
	boss := e.as("boss", "boss-pass")
	w := boss.do("POST", "/api/v1/admin/tunnel", `{"confirm_public": true}`)
	if w.Code != 503 || !strings.Contains(w.Body.String(), "cloudflared") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if n := count(e, "SELECT COUNT(*) FROM audit_log WHERE action = 'увімкнено публічний доступ'"); n != 0 {
		t.Fatal("failed start audited")
	}
}

func TestBackupsListAndHealth(t *testing.T) {
	bk, mut := withBackups(t)
	e := newEnv(t, mut)
	os.MkdirAll(bk.Dir, 0o755)
	os.WriteFile(filepath.Join(bk.Dir, "reports-20261101-010000.db"), make([]byte, 10), 0o644)
	os.WriteFile(filepath.Join(bk.Dir, "reports-20261102-010000-snapshot.db"), make([]byte, 20), 0o644)
	os.WriteFile(filepath.Join(bk.Dir, "other.txt"), []byte("x"), 0o644)
	boss := e.as("boss", "boss-pass")

	w := boss.do("GET", "/api/v1/admin/backups", "")
	var list []map[string]any
	json.Unmarshal(w.Body.Bytes(), &list)
	if w.Code != 200 || len(list) != 2 || list[0]["name"] != "reports-20261102-010000-snapshot.db" || list[0]["size_bytes"].(float64) != 20 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if ts := list[0]["created_at"].(string); !strings.HasSuffix(ts, "Z") {
		t.Fatalf("created_at %q", ts)
	}
	for q, want := range map[string]int{"limit=1": 1, "limit=0": 1, "limit=-5": 1, "limit=500": 2} {
		var l []any
		json.Unmarshal(boss.do("GET", "/api/v1/admin/backups?"+q, "").Body.Bytes(), &l)
		if len(l) != want {
			t.Errorf("%s: %d rows, want %d", q, len(l), want)
		}
	}
	if w := boss.do("GET", "/api/v1/admin/backups?limit=abc", ""); w.Code != 422 {
		t.Fatalf("limit=abc: %d", w.Code)
	}

	h := boss.json("GET", "/api/v1/admin/system/health", "", 200)
	if h["database_ok"] != true || h["integrity"] != "ok" || h["backups_count"].(float64) != 2 || h["backup_every_min"].(float64) != 60 ||
		h["journal_mode"] != e.st.JournalMode || h["database_size_bytes"].(float64) <= 0 {
		t.Fatalf("%v", h)
	}
	if !strings.HasSuffix(h["last_backup_at"].(string), "Z") {
		t.Fatalf("%v", h["last_backup_at"])
	}
}

func TestHealthWithoutBackups(t *testing.T) {
	e := newEnv(t, nil)
	h := e.as("boss", "boss-pass").json("GET", "/api/v1/admin/system/health", "", 200)
	if h["last_backup_at"] != nil || h["backups_count"].(float64) != 0 {
		t.Fatalf("%v", h)
	}
	e.as("boss", "boss-pass").json("GET", "/api/v1/admin/backups", "", 200)
}

func TestBackupDownload(t *testing.T) {
	bk, mut := withBackups(t)
	bk.Now = func() time.Time { return time.Now() }
	e := newEnv(t, mut)
	seedDemo(t, e)
	boss := e.as("boss", "boss-pass")
	for i := 0; i < 2; i++ { // repeat downloads with no change in between both succeed
		w := boss.do("GET", "/api/v1/admin/backup/download", "")
		if w.Code != 200 {
			t.Fatalf("download %d: %d %s", i, w.Code, w.Body.String())
		}
		if w.Header().Get("Content-Type") != "application/octet-stream" ||
			!strings.HasPrefix(w.Header().Get("Content-Disposition"), `attachment; filename="reports-`) ||
			!strings.Contains(w.Header().Get("Content-Disposition"), "-snapshot.db") {
			t.Fatalf("headers %v", w.Header())
		}
		if !strings.HasPrefix(w.Body.String(), "SQLite format 3") {
			t.Fatal("not a SQLite file")
		}
	}
	if n := count(e, "SELECT COUNT(*) FROM audit_log WHERE action = 'завантажено бекап'"); n != 2 {
		t.Fatalf("audit rows: %d", n)
	}
}

func TestBackupDownloadWithoutBackupsIs500(t *testing.T) {
	e := newEnv(t, nil)
	if w := e.as("boss", "boss-pass").do("GET", "/api/v1/admin/backup/download", ""); w.Code != 500 {
		t.Fatalf("%d", w.Code)
	}
}

func TestOverviewByRole(t *testing.T) {
	e := newEnv(t, nil)
	seedDemo(t, e)
	tx, _ := e.st.W.Begin()
	roles, _ := platform.EnsureBuiltInRoles(tx, nil)
	var org int64
	tx.QueryRow("SELECT id FROM organisations WHERE name = 'Магазин 1'").Scan(&org)
	h, _ := platform.HashPassword("pw", nil)
	platform.CreateUser(tx, "manager", h, &org, e.now, roles["org_admin"])
	tx.Commit()

	admin := e.as("boss", "boss-pass").json("GET", "/api/v1/admin/overview", "", 200)
	acc := admin["accounts"].(map[string]any)
	if acc["organisations"].(float64) != 2 || acc["users"].(float64) != 4 || acc["roles"].(float64) < 3 {
		t.Fatalf("%v", acc)
	}
	if admin["tunnel"] == nil || admin["health"] == nil || len(admin["recent_activity"].([]any)) == 0 || len(admin["recent_activity"].([]any)) > 6 {
		t.Fatalf("%v", admin)
	}
	mods := admin["modules"].([]any)
	if len(mods) != 2 || mods[0].(map[string]any)["module"] != "reports" || mods[1].(map[string]any)["module"] != "transport" {
		t.Fatalf("%v", mods)
	}
	stats := mods[0].(map[string]any)["stats"].([]any)
	if len(stats) != 2 || stats[0].(map[string]any)["value"] != "0 / 2" || stats[1].(map[string]any)["value"] != "3" || stats[1].(map[string]any)["section"] != "products" {
		t.Fatalf("%v", stats)
	}

	mgr := e.as("manager", "pw").json("GET", "/api/v1/admin/overview", "", 200)
	macc := mgr["accounts"].(map[string]any)
	if macc["organisations"].(float64) != 1 || macc["users"].(float64) != 2 || macc["roles"].(float64) != 0 {
		t.Fatalf("%v", macc)
	}
	if mgr["tunnel"] != nil || mgr["health"] != nil || mgr["recent_activity"] != nil || len(mgr["modules"].([]any)) != 0 {
		t.Fatalf("%v", mgr)
	}

	store := e.as("store1", "store1").json("GET", "/api/v1/admin/overview", "", 200)
	if store["accounts"] != nil || store["tunnel"] != nil || len(store["modules"].([]any)) != 0 {
		t.Fatalf("%v", store)
	}
	e.json2401(t)
}

func (e *env) json2401(t *testing.T) {
	if w := e.do("GET", "/api/v1/admin/overview", "", nil); w.Code != 401 {
		t.Fatalf("anonymous overview: %d", w.Code)
	}
}
