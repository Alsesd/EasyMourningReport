package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

const snapshots = "../../testdata/schema/"

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "reports.db"), "wal")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// loadSnapshot builds a DB from a testdata/schema/*.sql snapshot (DDL + recorded migration ids).
func loadSnapshot(t *testing.T, s *Store, name string) {
	t.Helper()
	raw, err := os.ReadFile(snapshots + name + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	ddl, ids, _ := strings.Cut(text, "-- migration ids")
	if _, err := s.W.Exec(ddl); err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	for _, l := range strings.Split(ids, "\n") {
		if id := strings.TrimSpace(strings.TrimPrefix(l, "--")); strings.Contains(id, ".") {
			if _, err := s.W.Exec("INSERT INTO schema_migrations (id) VALUES (?)", id); err != nil {
				t.Fatal(err)
			}
		}
	}
}

// structure dumps table_info, index_list and foreign_key_list for every table (R1: never DDL text).
func structure(t *testing.T, db *sql.DB) string {
	t.Helper()
	var tables []string
	// Tables owned by the Go program are not part of the Python shape being compared.
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('user_sessions', 'session_devices', 'passkeys', 'transport_orders', 'transport_order_stops', 'transport_order_events', 'report_submissions') ORDER BY name")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var n string
		rows.Scan(&n)
		tables = append(tables, n)
	}
	rows.Close()
	var out []string
	dump := func(table, pragma string) {
		r, err := db.Query(fmt.Sprintf("PRAGMA %s(%q)", pragma, table))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Close()
		cols, _ := r.Columns()
		for r.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			r.Scan(ptrs...)
			var parts []string
			for i, c := range cols {
				if c == "seq" || c == "cid" && false {
					continue
				}
				parts = append(parts, fmt.Sprintf("%s=%v", c, vals[i]))
			}
			out = append(out, table+" "+pragma+" "+strings.Join(parts, ","))
		}
	}
	for _, tb := range tables {
		dump(tb, "table_info")
		dump(tb, "index_list")
		dump(tb, "foreign_key_list")
	}
	sort.Strings(out)
	return strings.Join(out, "\n")
}

func TestEnsureSchemaLeavesPythonDatabasesUnchanged(t *testing.T) {
	for _, name := range []string{"fresh", "migrated_very_old", "migrated_previous_release"} {
		t.Run(name, func(t *testing.T) {
			s := openTemp(t)
			loadSnapshot(t, s, name)
			before := structure(t, s.R)
			if err := s.EnsureSchema(); err != nil {
				t.Fatal(err)
			}
			if after := structure(t, s.R); after != before {
				t.Fatalf("schema changed:\nbefore:\n%s\nafter:\n%s", before, after)
			}
		})
	}
}

func TestGoFreshMatchesPythonFresh(t *testing.T) {
	py := openTemp(t)
	loadSnapshot(t, py, "fresh")
	g := openTemp(t)
	if err := g.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	if a, b := structure(t, g.R), structure(t, py.R); a != b {
		t.Fatalf("Go-fresh differs from Python-fresh:\n%s\n---\n%s", a, b)
	}
	var n int
	g.R.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&n)
	if n != len(RequiredMigrations) {
		t.Fatalf("recorded %d migration ids", n)
	}
	// Idempotent: a second start changes nothing.
	if err := g.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
}

func TestEmbeddedSchemaEqualsSnapshot(t *testing.T) {
	raw, err := os.ReadFile(snapshots + "fresh.sql")
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != freshSQL {
		t.Fatal("internal/store/schema/fresh.sql is out of date: copy testdata/schema/fresh.sql")
	}
}

func TestRefusesDatabaseMissingMigrations(t *testing.T) {
	s := openTemp(t)
	loadSnapshot(t, s, "migrated_previous_release")
	if _, err := s.W.Exec("DELETE FROM schema_migrations WHERE id = 'reports.0002_settings_table'"); err != nil {
		t.Fatal(err)
	}
	err := s.EnsureSchema()
	if err == nil || !strings.Contains(err.Error(), "reports.0002_settings_table") {
		t.Fatalf("expected refusal naming the missing id, got %v", err)
	}
}

func TestCreatesOnlyMissingTables(t *testing.T) {
	s := openTemp(t)
	loadSnapshot(t, s, "migrated_previous_release")
	if _, err := s.W.Exec("DROP TABLE report_settings"); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	var n int
	s.R.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE name='report_settings'").Scan(&n)
	if n != 1 {
		t.Fatal("missing table not created")
	}
}

func TestForeignKeysAndPragmasApplyToEveryConnection(t *testing.T) {
	s := openTemp(t)
	if err := s.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	for name, db := range map[string]*sql.DB{"W": s.W, "R": s.R} {
		var fk, sync int
		var jm string
		db.QueryRow("PRAGMA foreign_keys").Scan(&fk)
		db.QueryRow("PRAGMA synchronous").Scan(&sync)
		db.QueryRow("PRAGMA journal_mode").Scan(&jm)
		if fk != 1 || sync != 2 || jm != "wal" {
			t.Errorf("%s: foreign_keys=%d synchronous=%d journal_mode=%s", name, fk, sync, jm)
		}
	}
	if _, err := s.W.Exec("INSERT INTO users (login, password_hash, organisation_id) VALUES ('a','b',999)"); err == nil {
		t.Fatal("foreign key not enforced")
	}
}

// R12 (verified): modernc parses columns declared DATETIME/TIMESTAMP into time.Time, so a plain
// SELECT ts scanned into a string comes back as RFC3339 ("...T...Z"). Handlers must read such
// columns with CAST(col AS TEXT) and bind preformatted strings.
func TestDatetimeStaysText(t *testing.T) {
	s := openTemp(t)
	if err := s.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	const ts = "2026-11-06 09:08:07.123456"
	if _, err := s.W.Exec("INSERT INTO audit_log (ts, login, role, action, detail, ip) VALUES (?, 'a','r','x','d','1')", ts); err != nil {
		t.Fatal(err)
	}
	var got, plain string
	if err := s.R.QueryRow("SELECT CAST(ts AS TEXT) FROM audit_log").Scan(&got); err != nil || got != ts {
		t.Fatalf("got %q err %v", got, err)
	}
	s.R.QueryRow("SELECT ts FROM audit_log").Scan(&plain)
	if plain == ts {
		t.Log("driver no longer reformats DATETIME columns; the CAST rule may be relaxed")
	}
}

func newBackups(t *testing.T, s *Store, keep int) *Backups {
	return &Backups{Store: s, Dir: filepath.Join(t.TempDir(), "backups"), Keep: keep}
}

func TestBackupRoundTrip(t *testing.T) {
	s := openTemp(t)
	if err := s.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	s.W.Exec("INSERT INTO organisations (name, archived) VALUES ('Shop', 0)")
	b := newBackups(t, s, 5)
	dest, err := b.Run("")
	if err != nil || dest == "" {
		t.Fatalf("backup: %q %v", dest, err)
	}
	// Restore into a fresh location and read it with Go.
	restored := filepath.Join(t.TempDir(), "reports.db")
	data, _ := os.ReadFile(dest)
	os.WriteFile(restored, data, 0o644)
	r, err := Open(restored, "wal")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	var name string
	if err := r.R.QueryRow("SELECT name FROM organisations").Scan(&name); err != nil || name != "Shop" {
		t.Fatalf("restored data: %q %v", name, err)
	}
	if v, _ := r.IntegrityCheck(); v != "ok" {
		t.Fatal(v)
	}
	if _, err := os.Stat(dest + "-wal"); err == nil {
		t.Fatal("backup must be a single self-contained file")
	}
}

func TestBackupSkipsWhenUnchangedAndSeesWALOnlyChange(t *testing.T) {
	s := openTemp(t)
	s.EnsureSchema()
	b := newBackups(t, s, 5)
	first, _ := b.Run("")
	if first == "" {
		t.Fatal("first backup missing")
	}
	// Age the backup so the comparison is not decided by clock granularity.
	old := time.Now().Add(-time.Hour)
	os.Chtimes(first, old, old)
	os.Chtimes(s.Path, old.Add(-time.Hour), old.Add(-time.Hour))
	os.Chtimes(s.Path+"-wal", old.Add(-time.Hour), old.Add(-time.Hour))
	if got, _ := b.Run(""); got != "" {
		t.Fatalf("unchanged database was backed up: %s", got)
	}
	// A write lands in the WAL only (no checkpoint): mtime of -wal moves, the main file does not.
	b.Now = func() time.Time { return time.Now().Add(2 * time.Second) }
	os.Chtimes(s.Path, old.Add(-time.Hour), old.Add(-time.Hour))
	s.W.Exec("INSERT INTO organisations (name, archived) VALUES ('WAL', 0)")
	os.Chtimes(s.Path, old.Add(-time.Hour), old.Add(-time.Hour))
	if got, err := b.Run(""); err != nil || got == "" {
		t.Fatalf("WAL-only change not backed up: %q %v", got, err)
	}
	// A tagged backup is never skipped.
	if got, _ := b.Run("before-delete"); !strings.HasSuffix(got, "-before-delete.db") {
		t.Fatalf("tagged backup: %q", got)
	}
}

func TestBackupRetentionAndSameSecondCollision(t *testing.T) {
	s := openTemp(t)
	s.EnsureSchema()
	b := newBackups(t, s, 3)
	clock := time.Date(2026, 1, 2, 3, 4, 5, 0, time.Local)
	b.Now = func() time.Time { return clock }
	a, _ := b.Run("x")
	c, err := b.Run("x") // same second, same tag
	if err != nil || c == a || c == "" {
		t.Fatalf("collision not handled: %q %q %v", a, c, err)
	}
	if b.List()[0] != c {
		t.Fatalf("collision copy must sort newest, list=%v", b.List())
	}
	for i := 0; i < 4; i++ {
		clock = clock.Add(time.Minute)
		if _, err := b.Run("t"); err != nil {
			t.Fatal(err)
		}
	}
	if n := len(b.List()); n != 3 {
		t.Fatalf("retention kept %d, want 3", n)
	}
	names := b.List()
	if !strings.Contains(names[0], "20260102-030805-t") {
		t.Fatalf("newest first expected, got %v", names)
	}
}

func TestBackupNameFormat(t *testing.T) {
	s := openTemp(t)
	s.EnsureSchema()
	b := newBackups(t, s, 3)
	b.Now = func() time.Time { return time.Date(2026, 11, 6, 7, 8, 9, 0, time.Local) }
	got, _ := b.Run("")
	if filepath.Base(got) != "reports-20261106-070809.db" {
		t.Fatal(got)
	}
}

func TestConcurrentBackupsAreSerialised(t *testing.T) {
	s := openTemp(t)
	s.EnsureSchema()
	b := newBackups(t, s, 50)
	b.Now = func() time.Time { return time.Date(2026, 1, 2, 3, 4, 5, 0, time.Local) }
	const n = 5
	paths := make(chan string, n)
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() {
			p, err := b.Run("x")
			paths <- p
			errs <- err
		}()
	}
	seen := map[string]bool{}
	for i := 0; i < n; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
		p := <-paths
		if p == "" || seen[p] {
			t.Fatalf("duplicate or empty backup path %q", p)
		}
		seen[p] = true
		if v, err := verifyCopy(p); err != nil || v != "ok" {
			t.Fatalf("%s: %v %s", p, err, v)
		}
	}
	if len(b.List()) != n {
		t.Fatalf("expected %d files, got %v", n, b.List())
	}
}

func TestGoOwnedTablesAreCreatedAndIdempotent(t *testing.T) {
	for _, name := range []string{"fresh", "migrated_very_old", "migrated_previous_release"} {
		s := openTemp(t)
		loadSnapshot(t, s, name)
		for i := 0; i < 2; i++ { // the second start must change nothing
			if err := s.EnsureSchema(); err != nil {
				t.Fatalf("%s: %v", name, err)
			}
		}
		for _, tb := range GoOwnedTables {
			var n int
			if err := s.R.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", tb).Scan(&n); err != nil || n != 1 {
				t.Fatalf("%s: table %s missing", name, tb)
			}
		}
	}
	g := openTemp(t)
	if err := g.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	var n int
	g.R.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'ix_user_sessions_%'").Scan(&n)
	if n != 2 {
		t.Fatalf("session indexes: %d", n)
	}
}

func TestOpenRefusesAnUnknownJournalMode(t *testing.T) {
	if _, err := Open(filepath.Join(t.TempDir(), "x.db"), "fancy"); err == nil {
		t.Fatal("an invalid journal mode must fail")
	}
}

func TestCheckpointAndPing(t *testing.T) {
	for _, mode := range []string{"wal", "delete"} {
		s, err := Open(filepath.Join(t.TempDir(), "x.db"), mode)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Ping(); err != nil {
			t.Fatal(err)
		}
		if err := s.Checkpoint(); err != nil {
			t.Fatalf("%s: %v", mode, err)
		}
		s.Close()
	}
}
