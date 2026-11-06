package platform

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"time"
)

// Built-in roles (backend/app/platform/accounts/permissions.py). platform_admin and org_admin
// hold every permission of their scope implicitly; "store" gets the modules' default grants.
type builtIn struct{ Key, Name, Scope string }

var BuiltInRoles = []builtIn{
	{"platform_admin", "Адміністратор", "platform"},
	{"org_admin", "Адміністратор організації", "organisation"},
	{"store", "Магазин", "organisation"},
}

// DefaultGrants mirrors Module.default_grants of the registered modules (reports only today).
var DefaultGrants = map[string][]string{
	"store": {"reports.submit"},
}

// SQLTimeFormat is the naive-UTC text format SQLAlchemy writes for DATETIME columns.
const SQLTimeFormat = "2006-01-02 15:04:05.000000"

// Seed ensures the built-in roles exist and, on an empty users table, creates the first admin.
// It reports the generated password through out (the Python banner) only when one is created.
func Seed(tx *sql.Tx, getenv func(string) string, out io.Writer, now time.Time) error {
	roleIDs := map[string]int64{}
	for _, r := range BuiltInRoles {
		var id int64
		err := tx.QueryRow(`SELECT id FROM roles WHERE "key" = ?`, r.Key).Scan(&id)
		if err == sql.ErrNoRows {
			res, err := tx.Exec(`INSERT INTO roles ("key", name, scope) VALUES (?, ?, ?)`, r.Key, r.Name, r.Scope)
			if err != nil {
				return fmt.Errorf("create role %s: %w", r.Key, err)
			}
			if id, err = res.LastInsertId(); err != nil {
				return err
			}
			for _, code := range DefaultGrants[r.Key] {
				if _, err := tx.Exec("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)", id, code); err != nil {
					return err
				}
			}
		} else if err != nil {
			return err
		}
		roleIDs[r.Key] = id
	}
	var any int
	if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM users)").Scan(&any); err != nil {
		return err
	}
	if any == 1 {
		return nil
	}
	pw := getenv("ADMIN_PASSWORD")
	if pw == "" {
		b := make([]byte, 9)
		if _, err := rand.Read(b); err != nil {
			return err
		}
		pw = base64.RawURLEncoding.EncodeToString(b)
	}
	hash, err := HashPassword(pw, nil)
	if err != nil {
		return err
	}
	res, err := tx.Exec(
		"INSERT INTO users (login, password_hash, full_name, active, organisation_id, created_at) VALUES ('admin', ?, '', 1, NULL, ?)",
		hash, now.UTC().Format(SQLTimeFormat))
	if err != nil {
		return err
	}
	uid, err := res.LastInsertId()
	if err != nil {
		return err
	}
	if _, err := tx.Exec("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, roleIDs["platform_admin"]); err != nil {
		return err
	}
	fmt.Fprintf(out, "\n*** ПЕРШИЙ ЗАПУСК: логін 'admin', пароль '%s'. Змініть його на сторінці «Налаштування». ***\n\n", pw)
	// DEMO=1 seeding belongs to the reports module (Slice 3/4); not ported yet.
	if getenv("DEMO") != "" {
		fmt.Fprintln(os.Stderr, "DEMO seeding is not ported yet")
	}
	return nil
}
