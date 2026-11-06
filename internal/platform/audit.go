package platform

import (
	"database/sql"
	"time"
)

// Audit appends one row to audit_log inside the caller's transaction. ts is stored as naive UTC
// text in SQLTimeFormat (same as before); the API adds a "Z" when it serves the value (Q5).
func Audit(tx *sql.Tx, now time.Time, ip, login, role, action, detail string) error {
	_, err := tx.Exec(
		"INSERT INTO audit_log (ts, login, role, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)",
		now.UTC().Format(SQLTimeFormat), login, role, action, detail, ip)
	return err
}
