package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"sort"
	"strings"
)

//go:embed schema/fresh.sql
var freshSQL string

// RequiredMigrations are the Python migration ids every production database must already
// carry. Go does not port the legacy upgrade code (migration-risks R2): a database missing
// one must first be started once with the last Python release.
var RequiredMigrations = []string{
	"platform.0001_organisations_and_roles",
	"reports.0001_legacy_columns",
	"reports.0002_settings_table",
}

type object struct {
	kind, name, table, sql string
}

// parseSchema reads the DDL blocks of testdata/schema/fresh.sql ("-- kind name (table t)" + SQL).
func parseSchema(text string) []object {
	var out []object
	lines := strings.Split(text, "\n")
	for i := 0; i < len(lines); i++ {
		l := lines[i]
		if !strings.HasPrefix(l, "-- table ") && !strings.HasPrefix(l, "-- index ") {
			continue
		}
		head := strings.TrimPrefix(l, "-- ")
		kind, rest, _ := strings.Cut(head, " ")
		name, tail, _ := strings.Cut(rest, " (table ")
		tbl := strings.TrimSuffix(tail, ")")
		var b []string
		for i++; i < len(lines) && strings.TrimSpace(lines[i]) != ""; i++ {
			b = append(b, lines[i])
		}
		out = append(out, object{kind, name, tbl, strings.TrimSuffix(strings.Join(b, "\n"), ";")})
	}
	return out
}

func existingTables(tx *sql.Tx) (map[string]bool, error) {
	rows, err := tx.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		m[n] = true
	}
	return m, rows.Err()
}

// EnsureSchema brings the file to a usable state without ever altering or rebuilding a table:
//   - an empty database gets the whole fresh schema and the required migration ids recorded;
//   - otherwise every required migration id must be present (else it refuses to start),
//     and only tables that are missing are created, with their indexes.
func (s *Store) EnsureSchema() error {
	tx, err := s.W.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tables, err := existingTables(tx)
	if err != nil {
		return err
	}
	objs := parseSchema(freshSQL)
	fresh := len(tables) == 0
	if !fresh {
		if err := checkMigrationIDs(tx, tables); err != nil {
			return err
		}
	}
	created := map[string]bool{}
	for _, o := range objs {
		if o.kind == "table" && !tables[o.name] {
			if _, err := tx.Exec(o.sql); err != nil {
				return fmt.Errorf("create table %s: %w", o.name, err)
			}
			created[o.name] = true
		}
	}
	for _, o := range objs {
		if o.kind == "index" && created[o.table] {
			if _, err := tx.Exec(o.sql); err != nil {
				return fmt.Errorf("create index %s: %w", o.name, err)
			}
		}
	}
	if fresh {
		for _, id := range RequiredMigrations {
			if _, err := tx.Exec("INSERT INTO schema_migrations (id) VALUES (?)", id); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func checkMigrationIDs(tx *sql.Tx, tables map[string]bool) error {
	have := map[string]bool{}
	if tables["schema_migrations"] {
		rows, err := tx.Query("SELECT id FROM schema_migrations")
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			have[id] = true
		}
		rows.Close()
	}
	var missing []string
	for _, id := range RequiredMigrations {
		if !have[id] {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("database is missing migrations %s: start the last Python release (git commit 92564ef or earlier) once to upgrade it, then retry",
			strings.Join(missing, ", "))
	}
	return nil
}
