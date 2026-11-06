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

func TestSeedCreatesOnlyTheAdmin(t *testing.T) {
	s, banner := seeded(t, map[string]string{"ADMIN_PASSWORD": "Secret-pw1"})
	if !strings.Contains(banner, "'Secret-pw1'") {
		t.Fatal(banner)
	}
	count := func(q string) int {
		var n int
		if err := s.R.QueryRow(q).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	// A new database holds the administrator, the one role they need, and nothing else.
	for q, want := range map[string]int{
		"SELECT COUNT(*) FROM users":            1,
		"SELECT COUNT(*) FROM roles":            1,
		"SELECT COUNT(*) FROM organisations":    0,
		"SELECT COUNT(*) FROM role_permissions": 0,
		"SELECT COUNT(*) FROM products":         0,
		"SELECT COUNT(*) FROM reports":          0,
		"SELECT COUNT(*) FROM transport_orders": 0,
		"SELECT COUNT(*) FROM report_settings":  0,
	} {
		if got := count(q); got != want {
			t.Errorf("%s = %d, want %d", q, got, want)
		}
	}
	var hash, created, key string
	var org any
	err := s.R.QueryRow(`SELECT u.password_hash, CAST(u.created_at AS TEXT), u.organisation_id, r."key" FROM users u
		JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.login='admin'`).Scan(&hash, &created, &org, &key)
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword("Secret-pw1", hash) || org != nil || key != "platform_admin" || created != "2026-01-02 03:04:05.678900" {
		t.Fatalf("admin row: org=%v key=%s created=%s", org, key, created)
	}
}

func TestSeedGeneratesACompliantPassword(t *testing.T) {
	_, banner := seeded(t, nil)
	i := strings.Index(banner, "пароль '")
	if i < 0 {
		t.Fatal(banner)
	}
	pw := banner[i+len("пароль '"):]
	pw = pw[:strings.Index(pw, "'")]
	if len(pw) != 12 || PasswordProblem(pw) != "" {
		t.Fatalf("generated password %q must satisfy the rules", pw)
	}
}

func TestSeedRefusesAWeakAdminPassword(t *testing.T) {
	s, err := store.Open(filepath.Join(t.TempDir(), "reports.db"), "wal")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.EnsureSchema()
	tx, _ := s.W.Begin()
	defer tx.Rollback()
	err = Seed(tx, func(k string) string {
		if k == "ADMIN_PASSWORD" {
			return "weakpass"
		}
		return ""
	}, &bytes.Buffer{}, time.Now())
	if err == nil || !strings.Contains(err.Error(), "ADMIN_PASSWORD") {
		t.Fatalf("a weak ADMIN_PASSWORD must stop the first start loudly: %v", err)
	}
}

func TestSeedDoesNotRecreateDivisionRolesOnLaterStarts(t *testing.T) {
	s, _ := seeded(t, nil) // seeded() runs Seed twice
	var n int
	s.R.QueryRow(`SELECT COUNT(*) FROM roles WHERE "key" IN ('org_admin', 'store')`).Scan(&n)
	if n != 0 {
		t.Fatalf("division roles must not appear: %d", n)
	}
}

func TestPasswordRules(t *testing.T) {
	good := []string{"Abcdefg1", "Пароль123", "Zz9zzzzz", strings.Repeat("aA1", 100)}
	bad := map[string]string{
		"Abcde1":   "щонайменше 8",
		"abcdefg1": "малі й великі",
		"ABCDEFG1": "малі й великі",
		"Abcdefgh": "малі й великі",
		"12345678": "малі й великі",
		"":         "щонайменше 8",
		"Аbcdefg":  "щонайменше 8", // 7 runes (Cyrillic А): rune count, not bytes
	}
	for _, pw := range good {
		if p := PasswordProblem(pw); p != "" {
			t.Errorf("%q rejected: %s", pw, p)
		}
	}
	for pw, want := range bad {
		if p := PasswordProblem(pw); !strings.Contains(p, want) {
			t.Errorf("%q: %q, want it to mention %q", pw, p, want)
		}
	}
}

func TestGeneratedPasswordsAreCompliantAndDifferent(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		pw, err := GeneratePassword()
		if err != nil || PasswordProblem(pw) != "" || len(pw) != 12 || seen[pw] {
			t.Fatalf("%q %v", pw, err)
		}
		seen[pw] = true
	}
}
