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
	// response do not sign the user out). A session without a row here is not valid. ip, user_agent and last_seen (refreshed when the token rolls) feed the administrators' session list.
	`CREATE TABLE IF NOT EXISTS session_devices (
		token_hash TEXT NOT NULL PRIMARY KEY,
		device_hash TEXT NOT NULL,
		prev_hash TEXT NOT NULL DEFAULT '',
		rotated_at INTEGER NOT NULL,
		ip TEXT NOT NULL DEFAULT '',
		user_agent TEXT NOT NULL DEFAULT '',
		last_seen INTEGER NOT NULL DEFAULT 0
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
		has_delivery INTEGER NOT NULL DEFAULT 0,
		delivery_car TEXT NOT NULL DEFAULT '',
		delivery_from TEXT NOT NULL DEFAULT '',
		delivery_time TEXT NOT NULL DEFAULT '',
		destination TEXT NOT NULL DEFAULT '',
		has_carriers INTEGER NOT NULL DEFAULT 0,
		carriers_car TEXT NOT NULL DEFAULT '',
		carriers_from TEXT NOT NULL DEFAULT '',
		carriers_count INTEGER NOT NULL DEFAULT 0,
		carriers_time TEXT NOT NULL DEFAULT '',
		cemetery_number TEXT NOT NULL DEFAULT '',
		is_military INTEGER NOT NULL DEFAULT 0,
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
	// Transport v2 (module transport): the fleet, product requests from the desks, goods runs and the cargo that
	// ties a requested item to the order or run stop that carries it. All Go-owned; none of it touches a Python
	// table (the order's car ids are additive columns, see goOwnedColumns).
	`CREATE TABLE IF NOT EXISTS transport_cars (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		plate TEXT NOT NULL UNIQUE,
		nonstandard INTEGER NOT NULL DEFAULT 0,
		label TEXT NOT NULL DEFAULT '',
		active INTEGER NOT NULL DEFAULT 1,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS product_requests (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		organisation_id INTEGER NOT NULL REFERENCES organisations (id),
		need_date TEXT NOT NULL,
		deceased TEXT NOT NULL DEFAULT '',
		notes TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		reply_note TEXT NOT NULL DEFAULT '',
		car_id INTEGER NULL,
		car_plate TEXT NOT NULL DEFAULT '',
		created_by_id INTEGER,
		created_by_name TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS ix_product_requests_org ON product_requests (organisation_id, need_date)`,
	`CREATE INDEX IF NOT EXISTS ix_product_requests_date ON product_requests (need_date)`,
	`CREATE TABLE IF NOT EXISTS product_request_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		request_id INTEGER NOT NULL REFERENCES product_requests (id) ON DELETE CASCADE,
		product_id INTEGER NOT NULL,
		product_name TEXT NOT NULL,
		quantity INTEGER NOT NULL CHECK (quantity > 0),
		unit_price_cents INTEGER NULL
	)`,
	`CREATE INDEX IF NOT EXISTS ix_product_request_items_request ON product_request_items (request_id)`,
	`CREATE TABLE IF NOT EXISTS transport_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		service_date TEXT NOT NULL,
		car_id INTEGER NOT NULL,
		car_plate TEXT NOT NULL,
		time TEXT NOT NULL,
		departure TEXT NOT NULL DEFAULT '',
		notes TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		created_by_id INTEGER,
		created_by_name TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS ix_transport_runs_date ON transport_runs (service_date)`,
	`CREATE TABLE IF NOT EXISTS transport_run_stops (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		run_id INTEGER NOT NULL REFERENCES transport_runs (id) ON DELETE CASCADE,
		position INTEGER NOT NULL,
		organisation_id INTEGER NOT NULL,
		place TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS ix_transport_run_stops_run ON transport_run_stops (run_id)`,
	`CREATE TABLE IF NOT EXISTS transport_cargo (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		item_id INTEGER NOT NULL REFERENCES product_request_items (id) ON DELETE CASCADE,
		quantity INTEGER NOT NULL,
		order_id INTEGER NULL REFERENCES transport_orders (id) ON DELETE CASCADE,
		run_stop_id INTEGER NULL REFERENCES transport_run_stops (id) ON DELETE CASCADE,
		CHECK ((order_id IS NULL) != (run_stop_id IS NULL))
	)`,
	`CREATE INDEX IF NOT EXISTS ix_transport_cargo_item ON transport_cargo (item_id)`,
	`CREATE INDEX IF NOT EXISTS ix_transport_cargo_order ON transport_cargo (order_id)`,
	`CREATE INDEX IF NOT EXISTS ix_transport_cargo_stop ON transport_cargo (run_stop_id)`,
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
	// Daily reports. A month (reports row) that has rows here is kept by days: report_items stays the month's
	// aggregate (the sum of its days, rebuilt in the same transaction as every day save), so the summary, the Excel
	// export and the dashboard read it as before. day is YYYY-MM-DD, or '' for the quantities a store had entered for
	// the whole month before it switched to days («без дати»). Each day is submitted (signed by the employee) and
	// locked or unlocked (by a reviewer) on its own; the reports row's status is derived: submitted when every day is.
	`CREATE TABLE IF NOT EXISTS report_days (
		report_id INTEGER NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
		day TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'draft',
		submitted_by_id INTEGER,
		submitted_by_name TEXT NOT NULL DEFAULT '',
		submitted_at INTEGER NOT NULL DEFAULT 0,
		locked_by_id INTEGER,
		locked_by_name TEXT NOT NULL DEFAULT '',
		locked_at INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (report_id, day)
	)`,
	// The quantities of one day of a report, like report_items (rows with both quantities 0 are not stored).
	`CREATE TABLE IF NOT EXISTS report_day_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		report_id INTEGER NOT NULL,
		day TEXT NOT NULL,
		product_id INTEGER NOT NULL REFERENCES products (id),
		unit_price_cents INTEGER NOT NULL,
		quantity INTEGER NOT NULL,
		quantity_calc INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (report_id, day) REFERENCES report_days (report_id, day) ON DELETE CASCADE
	)`,
	`CREATE INDEX IF NOT EXISTS ix_report_day_items_day ON report_day_items (report_id, day)`,
	// The days the midnight close has processed (one row per date), so a restart or a long downtime neither
	// closes a day twice nor skips one.
	`CREATE TABLE IF NOT EXISTS report_day_close (
		day TEXT NOT NULL PRIMARY KEY,
		closed_at INTEGER NOT NULL
	)`,
	// In-app notifications (the bell): one row per recipient. read_at is 0 while unread. dedupe_key makes a
	// reminder idempotent per user (a restart or a second evaluation inserts nothing); it is '' for events.
	// Rows change on every read and are pruned, so backups do not count them as a data change.
	`CREATE TABLE IF NOT EXISTS notifications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		kind TEXT NOT NULL,
		title TEXT NOT NULL,
		body TEXT NOT NULL DEFAULT '',
		link TEXT NOT NULL DEFAULT '',
		dedupe_key TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		read_at INTEGER NOT NULL DEFAULT 0,
		pushed_at INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications (user_id, id)`,
	// Web Push subscriptions: one row per browser. The endpoint identifies the browser; whoever signs in on it owns
	// it (a shared device is reassigned, and signing out deletes it). p256dh and auth are the browser's public key
	// and secret for message encryption, not credentials of this server.
	`CREATE TABLE IF NOT EXISTS push_subscriptions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		endpoint TEXT NOT NULL UNIQUE,
		p256dh TEXT NOT NULL,
		auth TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user ON push_subscriptions (user_id)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key != ''`,
}

// goOwnedColumns are columns added to Go-owned tables after their first release. CREATE TABLE IF NOT EXISTS does
// not touch an existing table, so each one is added once with ALTER TABLE (a constant default keeps old rows valid).
var goOwnedColumns = []struct{ table, column, def string }{
	{"transport_orders", "is_military", "INTEGER NOT NULL DEFAULT 0"},
	// pushed_at: 0 = not yet handed to the push dispatcher (a stale row is retired by the dispatcher, never sent).
	{"notifications", "pushed_at", "INTEGER NOT NULL DEFAULT 0"},
	// Fleet links of an order's two parts (NULL = a free-text car, or none yet). The text columns stay the snapshot.
	{"transport_orders", "delivery_car_id", "INTEGER"},
	{"transport_orders", "carriers_car_id", "INTEGER"},
	// Daily reports closed at midnight: missed = 1 when the store had not submitted the day by then (kept after a
	// late submission, as the record of it); auto_locked_at = when the day was closed automatically (0 = never).
	{"report_days", "missed", "INTEGER NOT NULL DEFAULT 0"},
	{"report_days", "auto_locked_at", "INTEGER NOT NULL DEFAULT 0"},
	// Several employees of one store fill in the same day: revision grows with every change (a save sent with an older
	// revision is refused instead of overwriting a colleague), saved_by_name/saved_at name the last one who saved.
	{"report_days", "revision", "INTEGER NOT NULL DEFAULT 0"},
	{"report_days", "saved_by_name", "TEXT NOT NULL DEFAULT ''"},
	{"report_days", "saved_at", "INTEGER NOT NULL DEFAULT 0"},
}

func addColumn(tx *sql.Tx, c struct{ table, column, def string }) error {
	var n int
	if err := tx.QueryRow("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?", c.table, c.column).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if _, err := tx.Exec("ALTER TABLE " + c.table + " ADD COLUMN " + c.column + " " + c.def); err != nil {
		return fmt.Errorf("add column %s.%s: %w", c.table, c.column, err)
	}
	return nil
}

// GoOwnedTables are the table names created from goOwned (tests strip them before comparing with Python).
var GoOwnedTables = []string{"user_sessions", "session_devices", "passkeys", "transport_orders", "transport_order_stops", "transport_order_events", "report_submissions", "notifications", "push_subscriptions",
	"transport_cars", "product_requests", "product_request_items", "transport_runs", "transport_run_stops", "transport_cargo", "report_days", "report_day_items", "report_day_close"}

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
	for _, c := range goOwnedColumns {
		if err := addColumn(tx, c); err != nil {
			return err
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
