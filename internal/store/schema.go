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

// goOwned is DDL for tables only the Go program uses. It is NOT part of schema/fresh.sql (which mirrors the
// Python release so the equivalence tests can compare), is applied to every database with IF NOT EXISTS, and
// is ignored by the Python release. user_sessions holds server-side sessions: only the SHA-256 of the random
// token is stored, so a copy of the database or a backup never contains a usable credential.
var goOwned = []string{
	`CREATE TABLE IF NOT EXISTS user_sessions (
		token_hash TEXT NOT NULL PRIMARY KEY,
		user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		created_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS ix_user_sessions_user ON user_sessions (user_id)`,
	`CREATE INDEX IF NOT EXISTS ix_user_sessions_expires ON user_sessions (expires_at)`,
	// session_devices binds a session to the one browser it was issued to: a rolling device token (only its
	// SHA-256 is stored; the previous one stays valid for a grace period so parallel requests and a lost
	// response do not sign the user out). A session without a row here is not valid.
	`CREATE TABLE IF NOT EXISTS session_devices (
		token_hash TEXT NOT NULL PRIMARY KEY,
		device_hash TEXT NOT NULL,
		prev_hash TEXT NOT NULL DEFAULT '',
		rotated_at INTEGER NOT NULL
	)`,
	// passkeys are WebAuthn credentials (Face ID, fingerprint, Windows Hello, security keys) a user registered.
	// public_key is PKIX DER; credential_id is base64url.
	`CREATE TABLE IF NOT EXISTS passkeys (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		credential_id TEXT NOT NULL UNIQUE,
		public_key BLOB NOT NULL,
		sign_count INTEGER NOT NULL DEFAULT 0,
		name TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		last_used_at INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE INDEX IF NOT EXISTS ix_passkeys_user ON passkeys (user_id)`,
	// Transport orders (module transport). One order per deceased: an optional delivery part (car, time,
	// destination) and an optional carriers part (men, time, departure place, cemetery number), at least one.
	// The submitting employee is stored as id plus a name snapshot so the signature survives renames.
	`CREATE TABLE IF NOT EXISTS transport_orders (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		organisation_id INTEGER NOT NULL REFERENCES organisations (id),
		service_date TEXT NOT NULL,
		deceased TEXT NOT NULL,
		notes TEXT NOT NULL DEFAULT '',
		car_number TEXT NOT NULL DEFAULT '',
		departure TEXT NOT NULL DEFAULT '',
		has_delivery INTEGER NOT NULL DEFAULT 0,
		delivery_time TEXT NOT NULL DEFAULT '',
		destination TEXT NOT NULL DEFAULT '',
		has_carriers INTEGER NOT NULL DEFAULT 0,
		carriers_count INTEGER NOT NULL DEFAULT 0,
		carriers_time TEXT NOT NULL DEFAULT '',
		cemetery_number TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		reply_note TEXT NOT NULL DEFAULT '',
		created_by_id INTEGER,
		created_by_name TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS ix_transport_orders_date ON transport_orders (service_date)`,
	`CREATE INDEX IF NOT EXISTS ix_transport_orders_org ON transport_orders (organisation_id, service_date)`,
	`CREATE TABLE IF NOT EXISTS transport_order_stops (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		order_id INTEGER NOT NULL REFERENCES transport_orders (id) ON DELETE CASCADE,
		part TEXT NOT NULL,
		position INTEGER NOT NULL,
		place TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS ix_transport_order_stops_order ON transport_order_stops (order_id)`,
	`CREATE TABLE IF NOT EXISTS transport_order_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		order_id INTEGER NOT NULL REFERENCES transport_orders (id) ON DELETE CASCADE,
		ts INTEGER NOT NULL,
		user_id INTEGER,
		user_name TEXT NOT NULL DEFAULT '',
		kind TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT '',
		note TEXT NOT NULL DEFAULT ''
	)`,
	`CREATE INDEX IF NOT EXISTS ix_transport_order_events_order ON transport_order_events (order_id)`,
	// The signature of a monthly report. One row per kind: "store" is the store employee who submitted it last
	// (kept after an administrator unlocks the report, replaced when the store submits again) and "admin" is
	// the administrator who locked it last. id plus a name snapshot, so the signature survives renames.
	// Reports from before this table have no row. A side table, because the reports table mirrors the Python
	// release and is never altered.
	`CREATE TABLE IF NOT EXISTS report_submissions (
		report_id INTEGER NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
		kind TEXT NOT NULL,
		user_id INTEGER,
		user_name TEXT NOT NULL,
		at INTEGER NOT NULL,
		PRIMARY KEY (report_id, kind)
	)`,
}

// GoOwnedTables are the table names created from goOwned (tests strip them before comparing with Python).
var GoOwnedTables = []string{"user_sessions", "session_devices", "passkeys", "transport_orders", "transport_order_stops", "transport_order_events", "report_submissions"}

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
	for _, ddl := range goOwned {
		if _, err := tx.Exec(ddl); err != nil {
			return fmt.Errorf("go-owned schema: %w", err)
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
