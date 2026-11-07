package platform

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"legkyi/internal/core"
)

// Built-in roles. platform_admin and org_admin
// hold every permission of their scope implicitly; "store" gets the modules' default grants.
type builtIn struct{ Key, Name, Scope string }

var BuiltInRoles = []builtIn{
	{"platform_admin", "Адміністратор", "platform"},
	{"org_admin", "Адміністратор підрозділу", "organisation"},
	{"store", "Підрозділ", "organisation"},
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

// EnsureAdminRole creates the platform administrator role when it is missing and returns its id. It is the
// only role a new installation starts with: division roles are made by the administrator in the role editor.
func EnsureAdminRole(tx *sql.Tx) (int64, error) {
	var id int64
	err := tx.QueryRow(`SELECT id FROM roles WHERE "key" = ?`, "platform_admin").Scan(&id)
	if err == sql.ErrNoRows {
		res, err := tx.Exec(`INSERT INTO roles ("key", name, scope) VALUES (?, ?, ?)`, "platform_admin", BuiltInRoles[0].Name, BuiltInRoles[0].Scope)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	return id, err
}

// EnsureStoreRole returns the id of the built-in desk role (key "store"), creating it with the modules' default
// grants when a fresh installation does not have it yet (a new installation starts with the administrator role only).
func EnsureStoreRole(tx *sql.Tx, grants map[string][]string) (int64, error) {
	var id int64
	err := tx.QueryRow(`SELECT id FROM roles WHERE "key" = ?`, StoreRole).Scan(&id)
	if err != sql.ErrNoRows {
		return id, err
	}
	r := BuiltInRoles[2]
	res, err := tx.Exec(`INSERT INTO roles ("key", name, scope) VALUES (?, ?, ?)`, r.Key, r.Name, r.Scope)
	if err != nil {
		return 0, fmt.Errorf("create role %s: %w", r.Key, err)
	}
	if id, err = res.LastInsertId(); err != nil {
		return 0, err
	}
	for _, code := range sortedCopy(grants[r.Key]) {
		if _, err := tx.Exec("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)", id, code); err != nil {
			return 0, err
		}
	}
	return id, nil
}

// Seed makes sure the administrator role exists and, on an empty users table, creates the first admin and
// nothing else: no divisions, no other roles, no data. The password banner goes to out only when an admin is
// created. With DEMO set, the module demo hooks run in the same transaction. ADMIN_PASSWORD must satisfy the
// password rules; without it a compliant random password is generated.
func Seed(tx *sql.Tx, getenv func(string) string, out io.Writer, now time.Time, demo ...core.SeedFunc) error {
	adminRole, err := EnsureAdminRole(tx)
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
		if pw, err = GeneratePassword(); err != nil {
			return err
		}
	} else if problem := PasswordProblem(pw); problem != "" {
		return fmt.Errorf("ADMIN_PASSWORD не підходить: %s", problem)
	}
	hash, err := HashPassword(pw, nil)
	if err != nil {
		return err
	}
	if _, err := CreateUser(tx, "admin", hash, nil, now, adminRole); err != nil {
		return err
	}
	if demoEnabled(getenv("DEMO")) {
		for _, seed := range demo {
			if err := seed(context.Background(), tx, now, DemoTools()); err != nil {
				return err
			}
		}
	}
	fmt.Fprintf(out, "\n*** ПЕРШИЙ ЗАПУСК: логін 'admin', пароль '%s'. Змініть його на сторінці «Налаштування». ***\n\n", pw)
	return nil
}

// demoEnabled: DEMO is off when empty or an explicit "0/false/no/off" (a literal DEMO=0 in .env must not enable it).
func demoEnabled(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "0", "false", "no", "off":
		return false
	}
	return true
}

// DemoTools are the services handed to the modules' demo seeds.
func DemoTools() core.SeedTools {
	return core.SeedTools{CreateUser: func(tx *sql.Tx, login, password string, orgID, roleID int64, now time.Time) error {
		hash, err := HashPassword(password, nil)
		if err != nil {
			return err
		}
		_, err = CreateUser(tx, login, hash, &orgID, now, roleID)
		return err
	}}
}
