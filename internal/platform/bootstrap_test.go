package platform

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"legkyi/internal/store"
)

func seeded(t *testing.T, env map[string]string) (*store.Store, string) {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "reports.db"), "wal")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if err := s.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	run := func() {
		tx, _ := s.W.Begin()
		defer tx.Rollback()
		if err := Seed(tx, func(k string) string { return env[k] }, &out, time.Date(2026, 1, 2, 3, 4, 5, 678900000, time.UTC)); err != nil {
			t.Fatal(err)
		}
		tx.Commit()
	}
	run()
	first := out.String()
	run() // idempotent
	if out.String() != first {
		t.Fatal("second seed must not create another admin or print again")
	}
	return s, first
}

func TestSeedCreatesRolesAndAdmin(t *testing.T) {
	s, banner := seeded(t, map[string]string{"ADMIN_PASSWORD": "secret-pw"})
	if !strings.Contains(banner, "'secret-pw'") {
		t.Fatal(banner)
	}
	var n int
	s.R.QueryRow("SELECT COUNT(*) FROM roles").Scan(&n)
	if n != 3 {
		t.Fatalf("roles=%d", n)
	}
	var perm string
	if err := s.R.QueryRow(`SELECT permission FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r."key"='store'`).Scan(&perm); err != nil || perm != "reports.submit" {
		t.Fatalf("store grants: %q %v", perm, err)
	}
	s.R.QueryRow(`SELECT COUNT(*) FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r."key" != 'store'`).Scan(&n)
	if n != 0 {
		t.Fatal("admin roles hold permissions implicitly, not as rows")
	}
	var hash, created, key string
	var org any
	err := s.R.QueryRow(`SELECT u.password_hash, CAST(u.created_at AS TEXT), u.organisation_id, r."key" FROM users u
		JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.login='admin'`).Scan(&hash, &created, &org, &key)
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword("secret-pw", hash) || org != nil || key != "platform_admin" || created != "2026-01-02 03:04:05.678900" {
		t.Fatalf("admin row: org=%v key=%s created=%s", org, key, created)
	}
}

func TestSeedGeneratesPasswordWhenNotConfigured(t *testing.T) {
	_, banner := seeded(t, nil)
	i := strings.Index(banner, "пароль '")
	if i < 0 {
		t.Fatal(banner)
	}
	pw := banner[i+len("пароль '"):]
	pw = pw[:strings.Index(pw, "'")]
	if len(pw) != 12 {
		t.Fatalf("token_urlsafe(9) is 12 chars, got %q", pw)
	}
}
