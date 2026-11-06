package platform

import (
	"context"
	"database/sql"
	"sort"
	"strings"
)

// Querier is satisfied by *sql.DB, *sql.Tx and *sql.Conn.
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type Role struct {
	ID    int64
	Key   string // "" for custom roles
	Name  string
	Scope string
}

type Organisation struct {
	ID       int64
	Name     string
	Archived bool
}

type User struct {
	ID           int64
	Login        string
	PasswordHash string
	FullName     string
	Active       bool
	Org          *Organisation
	Roles        []Role
}

// Principal is the signed-in user plus the permissions their roles grant.
type Principal struct {
	User        User
	Permissions map[string]bool
}

func (p *Principal) Can(codes ...string) bool {
	for _, c := range codes {
		if p.Permissions[c] {
			return true
		}
	}
	return false
}

func (p *Principal) OrganisationID() *int64 {
	if p.User.Org == nil {
		return nil
	}
	return &p.User.Org.ID
}

// RoleLabel is the audit log's role column: sorted role names, or "без ролі".
func (u User) RoleLabel() string {
	names := make([]string, len(u.Roles))
	for i, r := range u.Roles {
		names[i] = r.Name
	}
	sort.Strings(names)
	if len(names) == 0 {
		return "без ролі"
	}
	return strings.Join(names, ", ")
}

func (u User) Scope() string {
	if u.Org != nil {
		return "organisation"
	}
	return "platform"
}

// CanSignIn: active account whose organisation (if any) exists and is not archived.
func (u User) CanSignIn() bool {
	if !u.Active {
		return false
	}
	return u.Org == nil || !u.Org.Archived
}

const userSelect = `SELECT u.id, u.login, u.password_hash, u.full_name, u.active,
	o.id, o.name, o.archived FROM users u LEFT JOIN organisations o ON o.id = u.organisation_id`

// LoadUserByID returns nil when the user does not exist.
func LoadUserByID(ctx context.Context, q Querier, id int64) (*User, error) {
	return loadUser(ctx, q, userSelect+" WHERE u.id = ?", id)
}

// LoadUserByLogin expects a normalised (trimmed, lower-case) login.
func LoadUserByLogin(ctx context.Context, q Querier, login string) (*User, error) {
	return loadUser(ctx, q, userSelect+" WHERE u.login = ?", login)
}

func loadUser(ctx context.Context, q Querier, query string, arg any) (*User, error) {
	var u User
	var active int
	var oid sql.NullInt64
	var oname sql.NullString
	var oarch sql.NullInt64
	err := q.QueryRowContext(ctx, query, arg).Scan(&u.ID, &u.Login, &u.PasswordHash, &u.FullName, &active, &oid, &oname, &oarch)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.Active = active != 0
	if oid.Valid {
		u.Org = &Organisation{ID: oid.Int64, Name: oname.String, Archived: oarch.Int64 != 0}
	}
	rows, err := q.QueryContext(ctx, `SELECT r.id, COALESCE(r."key", ''), r.name, r.scope FROM roles r
		JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id`, u.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r Role
		if err := rows.Scan(&r.ID, &r.Key, &r.Name, &r.Scope); err != nil {
			return nil, err
		}
		u.Roles = append(u.Roles, r)
	}
	return &u, rows.Err()
}

// PrincipalFor computes effective permissions: for roles matching the user's scope,
// platform_admin/org_admin get every code of their scope, other roles their grants
// restricted to codes that exist in that scope.
func PrincipalFor(ctx context.Context, q Querier, u *User, codesByScope func(scope string) map[string]bool) (*Principal, error) {
	scope := u.Scope()
	perms := map[string]bool{}
	for _, r := range u.Roles {
		if r.Scope != scope {
			continue
		}
		codes := codesByScope(r.Scope)
		if _, all := AllOfScope[r.Key]; all {
			for c := range codes {
				perms[c] = true
			}
			continue
		}
		rows, err := q.QueryContext(ctx, "SELECT permission FROM role_permissions WHERE role_id = ?", r.ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				rows.Close()
				return nil, err
			}
			if codes[c] {
				perms[c] = true
			}
		}
		rows.Close()
	}
	return &Principal{User: *u, Permissions: perms}, nil
}
