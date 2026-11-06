package platform

import (
	"context"
	"database/sql"
	"legkyi/internal/core"
	"sort"
	"strings"
)

type Querier = core.Querier

type Role struct {
	ID     int64
	Key    string // "" for custom roles
	Name   string
	Scope  string
	OrgID  *int64
	Grants []string // permission codes stored for the role
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
	roles, err := LoadRoles(ctx, q, `WHERE r.id IN (SELECT role_id FROM user_roles WHERE user_id = ?)`, u.ID)
	if err != nil {
		return nil, err
	}
	u.Roles = roles
	return &u, nil
}

// LoadRoles loads roles (with their stored grants) ordered by id. where may be "" or a
// clause over the alias r, e.g. "WHERE r.scope = ?".
func LoadRoles(ctx context.Context, q Querier, where string, args ...any) ([]Role, error) {
	rows, err := q.QueryContext(ctx, `SELECT r.id, COALESCE(r."key", ''), r.name, r.scope, r.organisation_id FROM roles r `+where+` ORDER BY r.id`, args...)
	if err != nil {
		return nil, err
	}
	var roles []Role
	idx := map[int64]int{}
	for rows.Next() {
		var r Role
		var oid sql.NullInt64
		if err := rows.Scan(&r.ID, &r.Key, &r.Name, &r.Scope, &oid); err != nil {
			rows.Close()
			return nil, err
		}
		if oid.Valid {
			v := oid.Int64
			r.OrgID = &v
		}
		idx[r.ID] = len(roles)
		roles = append(roles, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(roles) == 0 {
		return roles, err
	}
	grows, err := q.QueryContext(ctx, `SELECT role_id, permission FROM role_permissions ORDER BY role_id, permission`)
	if err != nil {
		return nil, err
	}
	defer grows.Close()
	for grows.Next() {
		var rid int64
		var code string
		if err := grows.Scan(&rid, &code); err != nil {
			return nil, err
		}
		if i, ok := idx[rid]; ok {
			roles[i].Grants = append(roles[i].Grants, code)
		}
	}
	return roles, grows.Err()
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
		for _, c := range r.Grants {
			if codes[c] {
				perms[c] = true
			}
		}
	}
	return &Principal{User: *u, Permissions: perms}, nil
}
