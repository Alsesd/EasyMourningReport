package platform

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// RuleError is a business-rule failure. Status 0 means a form error (HTTP 422 with
// code "validation_error"); any other value is the HTTP status of an HTTPException.
type RuleError struct {
	Status int
	Msg    string
}

func (e RuleError) Error() string { return e.Msg }

func form(msg string) error                          { return RuleError{0, msg} }
func forbidden(msg string) error                     { return RuleError{403, msg} }
func notFound(msg string) error                      { return RuleError{404, msg} }
func formf(f string, a ...any) error                 { return RuleError{0, fmt.Sprintf(f, a...)} }
func (r Rules) allowed(scope string) map[string]bool { return r.Codes(scope) }

// Rules holds the permission catalogue needed by the account rules (codes by scope).
// All rule functions take a Querier (normally the caller's *sql.Tx) and nothing else, so a
// handler's reads and writes stay in one transaction.
type Rules struct {
	Codes func(scope string) map[string]bool
}

// --- text normalisation (core/text.py) ---------------------------------------------

func NormLogin(raw string) string { return strings.ToLower(strings.TrimSpace(raw)) }

func NormName(raw string) string { return strings.Join(strings.Fields(raw), " ") }

// SameName compares names the way Python's casefold does (strings.ToLower for Cyrillic).
func SameName(a, b string) bool { return strings.ToLower(NormName(a)) == strings.ToLower(NormName(b)) }

func validLogin(l string) bool {
	n := utf8.RuneCountInString(l)
	if n < 2 || n > 40 {
		return false
	}
	return strings.IndexFunc(l, unicode.IsSpace) < 0
}

// CleanLogin normalises a login or returns the form error.
func CleanLogin(raw string) (string, error) {
	l := NormLogin(raw)
	if !validLogin(l) {
		return "", form("Логін: від 2 до 40 символів, без пробілів")
	}
	return l, nil
}

// CleanName collapses whitespace and enforces 1..100 characters; what names the entity.
func CleanName(raw, what string) (string, error) {
	n := NormName(raw)
	if n == "" {
		return "", formf("%s не може бути порожньою", what)
	}
	if utf8.RuneCountInString(n) > 100 {
		return "", formf("%s задовга (до 100 символів)", what)
	}
	return n, nil
}

// CleanFullName collapses whitespace and truncates to 100 characters (never an error).
func CleanFullName(raw string) string {
	n := []rune(NormName(raw))
	if len(n) > 100 {
		n = n[:100]
	}
	return string(n)
}

// --- who may manage which accounts (accounts/service.py) -----------------------------

// ManagedOrganisation returns the organisation an org-level manager is limited to
// (nil for platform managers) or a 403.
func ManagedOrganisation(p *Principal) (*int64, error) {
	if p.Can(UsersManage) {
		return nil, nil
	}
	if p.Can(OrgUsersManage) && p.User.Org != nil {
		id := p.User.Org.ID
		return &id, nil
	}
	return nil, forbidden("Недостатньо прав для цієї дії.")
}

// CheckCanManageUser hides users outside an org manager's organisation behind a 404.
func CheckCanManageUser(p *Principal, u *User) error {
	limit, err := ManagedOrganisation(p)
	if err != nil {
		return err
	}
	if limit != nil && (u.Org == nil || u.Org.ID != *limit) {
		return notFound("Користувача не знайдено.")
	}
	return nil
}

func LoadOrganisation(ctx context.Context, q Querier, id int64) (*Organisation, error) {
	var o Organisation
	var arch int
	err := q.QueryRowContext(ctx, "SELECT id, name, archived FROM organisations WHERE id = ?", id).Scan(&o.ID, &o.Name, &arch)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	o.Archived = arch != 0
	return &o, err
}

// ResolveTargetOrganisation: org managers always act in their own organisation; platform
// managers may name one (nil = platform staff). An unknown organisation is a 404.
func ResolveTargetOrganisation(ctx context.Context, q Querier, p *Principal, orgID *int64) (*Organisation, error) {
	limit, err := ManagedOrganisation(p)
	if err != nil {
		return nil, err
	}
	if limit != nil {
		orgID = limit
	}
	if orgID == nil {
		return nil, nil
	}
	o, err := LoadOrganisation(ctx, q, *orgID)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, notFound("Підрозділ не знайдено.")
	}
	return o, nil
}

// RolePermissions is the set of codes a role grants. A role is just a set of permissions: the platform
// administrator holds every platform-level code, the (legacy) division administrator every division-level code, any other
// role its grants limited to codes that exist. Where a user's data ends is decided by the user's division and by
// the permissions themselves (seeing other divisions needs one), not by a role type.
func (r Rules) RolePermissions(role Role) map[string]bool {
	return effectiveCodes(role, r.Codes)
}

// effectiveCodes resolves a role against the catalogue of codes by scope ("" = all).
func effectiveCodes(role Role, codesByScope func(scope string) map[string]bool) map[string]bool {
	out := map[string]bool{}
	if scope, all := AllOfScope[role.Key]; all {
		for c := range codesByScope(scope) {
			out[c] = true
		}
		return out
	}
	known := codesByScope("")
	for _, c := range role.Grants {
		if known[c] {
			out[c] = true
		}
	}
	return out
}

func subset(a, b map[string]bool) bool {
	for k := range a {
		if !b[k] {
			return false
		}
	}
	return true
}

// AssignableRoles are the roles the caller may give to a user of orgID (nil = platform staff),
// ordered by name (SQL binary order). Org managers get only roles whose permissions they hold.
func (r Rules) AssignableRoles(ctx context.Context, q Querier, p *Principal, orgID *int64) ([]Role, error) {
	var roles []Role
	var err error
	if orgID == nil {
		roles, err = LoadRoles(ctx, q, "WHERE r.organisation_id IS NULL")
	} else {
		roles, err = LoadRoles(ctx, q, "WHERE r.organisation_id IS NULL OR r.organisation_id = ?", *orgID)
	}
	if err != nil {
		return nil, err
	}
	sort.SliceStable(roles, func(i, j int) bool { return roles[i].Name < roles[j].Name })
	if p.Can(UsersManage) {
		return roles, nil
	}
	var out []Role
	for _, role := range roles {
		if subset(r.RolePermissions(role), p.Permissions) {
			out = append(out, role)
		}
	}
	return out, nil
}

// ResolveRoles validates role ids against AssignableRoles and returns them de-duplicated.
func (r Rules) ResolveRoles(ctx context.Context, q Querier, p *Principal, orgID *int64, ids []int64) ([]Role, error) {
	allowed, err := r.AssignableRoles(ctx, q, p, orgID)
	if err != nil {
		return nil, err
	}
	byID := map[int64]Role{}
	for _, role := range allowed {
		byID[role.ID] = role
	}
	var chosen []Role
	seen := map[int64]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		role, ok := byID[id]
		if !ok {
			return nil, form("Цю роль не можна призначити цьому користувачеві.")
		}
		chosen = append(chosen, role)
	}
	return chosen, nil
}

// KeepUnassignableRoles: an org manager may not strip roles they could not have granted, so
// those the user already has are kept next to the requested ones.
func (r Rules) KeepUnassignableRoles(p *Principal, user *User, requested []Role, orgID *int64) []Role {
	if p.Can(UsersManage) {
		return requested
	}
	var merged []Role
	seen := map[int64]bool{}
	add := func(role Role) {
		if !seen[role.ID] {
			seen[role.ID] = true
			merged = append(merged, role)
		}
	}
	for _, role := range user.Roles {
		sameOrg := role.OrgID == nil || (orgID != nil && *role.OrgID == *orgID)
		if !subset(r.RolePermissions(role), p.Permissions) && sameOrg {
			add(role)
		}
	}
	for _, role := range requested {
		add(role)
	}
	return merged
}

// HoldsNoMoreThan: an org manager may only act on accounts that hold no more than they do.
func (r Rules) HoldsNoMoreThan(p *Principal, user *User) bool {
	granted := map[string]bool{}
	for _, role := range user.Roles {
		for c := range r.RolePermissions(role) {
			granted[c] = true
		}
	}
	return subset(granted, p.Permissions)
}

// CheckUniqueLogin: logins are case-insensitive (stored normalised); excludeID skips the user being edited.
func CheckUniqueLogin(ctx context.Context, q Querier, login string, excludeID int64) error {
	var n int
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM users WHERE login = ? AND id != ?", login, excludeID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return formf("Логін «%s» уже зайнятий. Логіни не залежать від регістру: Store1 і store1 — той самий.", login)
	}
	return nil
}

// CheckUniqueOrganisation compares normalised, case-folded names (archived ones count).
func CheckUniqueOrganisation(ctx context.Context, q Querier, name string, excludeID int64) error {
	rows, err := q.QueryContext(ctx, "SELECT id, name, archived FROM organisations ORDER BY id")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var n string
		var arch int
		if err := rows.Scan(&id, &n, &arch); err != nil {
			return err
		}
		if id != excludeID && SameName(n, name) {
			msg := fmt.Sprintf("Підрозділ з назвою «%s» уже існує", n)
			if arch != 0 {
				msg += " (в архіві)"
			}
			return form(msg)
		}
	}
	return rows.Err()
}

// CheckRoleName rejects a role name already used (case-insensitively) in the same organisation scope.
func CheckRoleName(ctx context.Context, q Querier, name string, orgID *int64, excludeID int64) error {
	rows, err := q.QueryContext(ctx, "SELECT name, organisation_id FROM roles WHERE id != ? ORDER BY id", excludeID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var n string
		var oid sql.NullInt64
		if err := rows.Scan(&n, &oid); err != nil {
			return err
		}
		same := (!oid.Valid && orgID == nil) || (oid.Valid && orgID != nil && oid.Int64 == *orgID)
		if same && strings.ToLower(n) == strings.ToLower(name) {
			return formf("Роль «%s» уже існує.", n)
		}
	}
	return rows.Err()
}

// ActivePlatformAdmins counts distinct active platform users holding the platform_admin role.
func ActivePlatformAdmins(ctx context.Context, q Querier) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, `SELECT COUNT(DISTINCT u.id) FROM users u
		JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
		WHERE r."key" = 'platform_admin' AND u.active != 0 AND u.organisation_id IS NULL`).Scan(&n)
	return n, err
}

// CheckAdminRemains must run after the change is applied inside the transaction: at least one
// active administrator has to be left, otherwise the caller rolls back.
func CheckAdminRemains(ctx context.Context, q Querier) error {
	n, err := ActivePlatformAdmins(ctx, q)
	if err != nil {
		return err
	}
	if n < 1 {
		return form("Має залишитися хоча б один активний адміністратор.")
	}
	return nil
}

// ValidatedPermissions: every code must exist; the result is sorted and unique. (The scope argument is kept for
// the callers' sake: a role is a plain set of permissions and may hold codes of any kind.)
func (r Rules) ValidatedPermissions(scope string, codes []string) ([]string, error) {
	allowed := r.Codes("")
	var unknown []string
	for _, c := range codes {
		if !allowed[c] {
			unknown = append(unknown, c)
		}
	}
	if len(unknown) > 0 {
		return nil, formf("Невідомі дозволи: %s", strings.Join(unknown, ", "))
	}
	set := map[string]bool{}
	for _, c := range codes {
		set[c] = true
	}
	out := make([]string, 0, len(set))
	for c := range set {
		out = append(out, c)
	}
	sort.Strings(out)
	return out, nil
}
