package platform

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
)

// Built-in roles. platform_admin and org_admin
// hold every permission of their scope implicitly; "store" gets the modules' default grants.
type builtIn struct{ Key, Name, Scope string }

var BuiltInRoles = []builtIn{
	{"platform_admin", "Адміністратор", "platform"},
	{"org_admin", "Адміністратор організації", "organisation"},
	{"store", "Магазин", "organisation"},
}

// SQLTimeFormat is the naive-UTC text format SQLAlchemy writes for DATETIME columns.
const SQLTimeFormat = "2006-01-02 15:04:05.000000"

func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

// EnsureBuiltInRoles creates any missing built-in role (newly created ones get the modules'
// default grants) and returns role ids by key.
func EnsureBuiltInRoles(tx *sql.Tx, grants map[string][]string) (map[string]int64, error) {
	roleIDs := map[string]int64{}
	for _, r := range BuiltInRoles {
		var id int64
		err := tx.QueryRow(`SELECT id FROM roles WHERE "key" = ?`, r.Key).Scan(&id)
		if err == sql.ErrNoRows {
			res, err := tx.Exec(`INSERT INTO roles ("key", name, scope) VALUES (?, ?, ?)`, r.Key, r.Name, r.Scope)
			if err != nil {
				return nil, fmt.Errorf("create role %s: %w", r.Key, err)
			}
			if id, err = res.LastInsertId(); err != nil {
				return nil, err
			}
			for _, code := range sortedCopy(grants[r.Key]) {
				if _, err := tx.Exec("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)", id, code); err != nil {
					return nil, err
				}
			}
		} else if err != nil {
			return nil, err
		}
		roleIDs[r.Key] = id
	}
	return roleIDs, nil
}

// CreateUser inserts an active user and links the given roles.
func CreateUser(tx *sql.Tx, login, passwordHash string, orgID *int64, now time.Time, roleIDs ...int64) (int64, error) {
	res, err := tx.Exec(
		"INSERT INTO users (login, password_hash, full_name, active, organisation_id, created_at) VALUES (?, ?, '', 1, ?, ?)",
		login, passwordHash, orgID, now.UTC().Format(SQLTimeFormat))
	if err != nil {
		return 0, err
	}
	uid, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	for _, rid := range roleIDs {
		if _, err := tx.Exec("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, rid); err != nil {
			return 0, err
		}
	}
	return uid, nil
}

// Seed ensures the built-in roles exist and, on an empty users table, creates the first admin.
// The password banner goes to out only when an admin is created. With DEMO set, the module
// demo hooks run in the same transaction.
func Seed(tx *sql.Tx, grants map[string][]string, getenv func(string) string, out io.Writer, now time.Time, demo ...func(context.Context, *sql.Tx, time.Time) error) error {
	roleIDs, err := EnsureBuiltInRoles(tx, grants)
	if err != nil {
		return err
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
	if _, err := CreateUser(tx, "admin", hash, nil, now, roleIDs["platform_admin"]); err != nil {
		return err
	}
	if demoEnabled(getenv("DEMO")) {
		for _, seed := range demo {
			if err := seed(context.Background(), tx, now); err != nil {
				return err
			}
		}
	}
	fmt.Fprintf(out, "\n*** ПЕРШИЙ ЗАПУСК: логін 'admin', пароль '%s'. Змініть його на сторінці «Налаштування». ***\n\n", pw)
	return nil
}

// demoEnabled: DEMO is off when empty or an explicit "0/false/no/off" (compose passes DEMO=0 by default).
func demoEnabled(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "0", "false", "no", "off":
		return false
	}
	return true
}
