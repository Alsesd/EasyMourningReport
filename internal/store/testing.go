package store

import (
	"os"
	"strings"
	"testing"
)

// LoadSnapshotForTest builds a Python-shaped database from testdata/schema/<name>.sql (DDL plus
// recorded migration ids). Callers run it on an empty Store before EnsureSchema.
func LoadSnapshotForTest(t testing.TB, s *Store, name string) {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/schema/" + name + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	ddl, ids, _ := strings.Cut(string(raw), "-- migration ids")
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
