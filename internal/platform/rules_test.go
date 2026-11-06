package platform

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"legkyi/internal/store"
)

var allCodes = map[string]map[string]bool{
	"platform":     {UsersManage: true, RolesManage: true, AuditView: true, OrganisationsManage: true, SystemManage: true, "reports.review": true},
	"organisation": {OrgUsersManage: true, "reports.submit": true, "transport.orders.create": true},
}

var testRules = Rules{Codes: func(s string) map[string]bool { return allCodes[s] }}

type fx struct {
	t   *testing.T
	s   *store.Store
	ctx context.Context
	tx  *sql.Tx
	// ids
	orgA, orgB                         int64
	roleAdmin, roleOrgAdmin, roleStore int64
}

func newFx(t *testing.T) *fx {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "r.db"), "wal")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if err := s.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	tx, err := s.W.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tx.Rollback() })
	f := &fx{t: t, s: s, ctx: context.Background(), tx: tx}
	roles, err := EnsureBuiltInRoles(tx, map[string][]string{"store": {"reports.submit"}})
	if err != nil {
		t.Fatal(err)
	}
	f.roleAdmin, f.roleOrgAdmin, f.roleStore = roles[PlatformAdmin], roles[OrgAdmin], roles[StoreRole]
	f.orgA, f.orgB = f.org("Shop A", false), f.org("Shop B", false)
	return f
}

func (f *fx) org(name string, archived bool) int64 {
	res, err := f.tx.Exec("INSERT INTO organisations (name, archived) VALUES (?, ?)", name, archived)
	if err != nil {
		f.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func (f *fx) user(login string, org *int64, active bool, roles ...int64) int64 {
	id, err := CreateUser(f.tx, login, "x", org, time.Now(), roles...)
	if err != nil {
		f.t.Fatal(err)
	}
	if !active {
		f.tx.Exec("UPDATE users SET active = 0 WHERE id = ?", id)
	}
	return id
}

func (f *fx) role(name, scope string, org *int64, perms ...string) int64 {
	res, err := f.tx.Exec("INSERT INTO roles (name, scope, organisation_id) VALUES (?, ?, ?)", name, scope, org)
	if err != nil {
		f.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	for _, p := range perms {
		f.tx.Exec("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)", id, p)
	}
	return id
}

func (f *fx) principal(uid int64) *Principal {
	u, err := LoadUserByID(f.ctx, f.tx, uid)
	if err != nil || u == nil {
		f.t.Fatal(err, u)
	}
	p, err := PrincipalFor(f.ctx, f.tx, u, func(s string) map[string]bool { return allCodes[s] })
	if err != nil {
		f.t.Fatal(err)
	}
	return p
}

func ruleStatus(err error) int {
	if re, ok := err.(RuleError); ok {
		return re.Status
	}
	return -1
}

func ptr(i int64) *int64 { return &i }

func TestManagedOrganisationAndUserVisibility(t *testing.T) {
	f := newFx(t)
	boss := f.principal(f.user("boss", nil, true, f.roleAdmin))
	mgr := f.principal(f.user("mgr", ptr(f.orgA), true, f.roleOrgAdmin))
	clerk := f.principal(f.user("clerk", ptr(f.orgA), true, f.roleStore))
	otherB := f.user("bob", ptr(f.orgB), true, f.roleStore)

	if lim, err := ManagedOrganisation(boss); err != nil || lim != nil {
		t.Fatal(lim, err)
	}
	if lim, err := ManagedOrganisation(mgr); err != nil || lim == nil || *lim != f.orgA {
		t.Fatal(lim, err)
	}
	if _, err := ManagedOrganisation(clerk); ruleStatus(err) != 403 {
		t.Fatalf("clerk: %v", err)
	}
	ub, _ := LoadUserByID(f.ctx, f.tx, otherB)
	if err := CheckCanManageUser(mgr, ub); ruleStatus(err) != 404 {
		t.Fatalf("org manager must not see other organisations: %v", err)
	}
	platformUser, _ := LoadUserByID(f.ctx, f.tx, boss.User.ID)
	if err := CheckCanManageUser(mgr, platformUser); ruleStatus(err) != 404 {
		t.Fatalf("org manager must not see platform staff: %v", err)
	}
	if err := CheckCanManageUser(boss, ub); err != nil {
		t.Fatal(err)
	}
	// An org manager is always pinned to their organisation, whatever the payload says.
	o, err := ResolveTargetOrganisation(f.ctx, f.tx, mgr, ptr(f.orgB))
	if err != nil || o.ID != f.orgA {
		t.Fatalf("pinned org: %v %v", o, err)
	}
	if _, err := ResolveTargetOrganisation(f.ctx, f.tx, boss, ptr(9999)); ruleStatus(err) != 404 {
		t.Fatal(err)
	}
	if o, err := ResolveTargetOrganisation(f.ctx, f.tx, boss, nil); err != nil || o != nil {
		t.Fatal("platform staff target must be nil")
	}
}

func names(roles []Role) string {
	n := make([]string, len(roles))
	for i, r := range roles {
		n[i] = r.Name
	}
	return strings.Join(n, ",")
}

func TestAssignableRolesEscalationGuards(t *testing.T) {
	f := newFx(t)
	boss := f.principal(f.user("boss", nil, true, f.roleAdmin))
	// A custom manager role: may manage users of its org but holds no reports permission.
	limited := f.role("Limited manager", "organisation", nil, OrgUsersManage)
	mgrLimited := f.principal(f.user("lim", ptr(f.orgA), true, limited))
	mgrFull := f.principal(f.user("full", ptr(f.orgA), true, f.roleOrgAdmin))
	reportsRole := f.role("Reports clerk", "organisation", nil, "reports.submit")
	onlyB := f.role("B only", "organisation", ptr(f.orgB), "reports.submit")
	onlyA := f.role("A only", "organisation", ptr(f.orgA))
	f.role("Staff", "platform", nil, AuditView)

	got, _ := testRules.AssignableRoles(f.ctx, f.tx, boss, ptr(f.orgA))
	if names(got) != "A only,Limited manager,Reports clerk,Магазин,Адміністратор організації" && !sameSet(names(got), "A only,Limited manager,Reports clerk,Магазин,Адміністратор організації") {
		t.Fatalf("platform manager, org A: %s", names(got))
	}
	for _, r := range got {
		if r.ID == onlyB {
			t.Fatal("role scoped to org B leaked into org A")
		}
	}
	got, _ = testRules.AssignableRoles(f.ctx, f.tx, boss, nil)
	if !sameSet(names(got), "Адміністратор,Staff") {
		t.Fatalf("platform staff roles: %s", names(got))
	}
	// A manager can only hand out what they hold themselves.
	got, _ = testRules.AssignableRoles(f.ctx, f.tx, mgrLimited, ptr(f.orgA))
	if !sameSet(names(got), "A only,Limited manager") {
		t.Fatalf("limited manager may assign: %s", names(got))
	}
	got, _ = testRules.AssignableRoles(f.ctx, f.tx, mgrFull, ptr(f.orgA))
	if !sameSet(names(got), "A only,Limited manager,Reports clerk,Магазин,Адміністратор організації") {
		t.Fatalf("org admin may assign: %s", names(got))
	}
	if _, err := testRules.ResolveRoles(f.ctx, f.tx, mgrLimited, ptr(f.orgA), []int64{reportsRole}); ruleStatus(err) != 0 {
		t.Fatalf("escalation not blocked: %v", err)
	}
	if _, err := testRules.ResolveRoles(f.ctx, f.tx, mgrFull, ptr(f.orgA), []int64{onlyB}); err == nil {
		t.Fatal("role of another organisation accepted")
	}
	if _, err := testRules.ResolveRoles(f.ctx, f.tx, boss, nil, []int64{f.roleStore}); err == nil {
		t.Fatal("organisation role accepted for platform staff")
	}
	chosen, err := testRules.ResolveRoles(f.ctx, f.tx, mgrFull, ptr(f.orgA), []int64{onlyA, onlyA, limited})
	if err != nil || len(chosen) != 2 {
		t.Fatalf("dedupe: %v %v", chosen, err)
	}
}

func sameSet(a, b string) bool {
	x, y := strings.Split(a, ","), strings.Split(b, ",")
	if len(x) != len(y) {
		return false
	}
	m := map[string]int{}
	for _, s := range x {
		m[s]++
	}
	for _, s := range y {
		m[s]--
	}
	for _, v := range m {
		if v != 0 {
			return false
		}
	}
	return true
}

func TestKeptRolesAndHoldsNoMoreThan(t *testing.T) {
	f := newFx(t)
	limited := f.role("Limited manager", "organisation", nil, OrgUsersManage)
	mgr := f.principal(f.user("lim", ptr(f.orgA), true, limited))
	boss := f.principal(f.user("boss", nil, true, f.roleAdmin))
	powerful := f.role("Powerful", "organisation", nil, OrgUsersManage, "reports.submit")
	scopedB := f.role("Scoped B", "organisation", ptr(f.orgB), "reports.submit", "transport.orders.create")
	plain := f.role("Plain", "organisation", nil, OrgUsersManage)
	target := f.user("t", ptr(f.orgA), true, powerful, scopedB, plain)
	u, _ := LoadUserByID(f.ctx, f.tx, target)

	// The manager asks for just "Plain"; the more powerful role of the same scope must survive.
	req, _ := testRules.ResolveRoles(f.ctx, f.tx, mgr, ptr(f.orgA), []int64{plain})
	kept := testRules.KeepUnassignableRoles(mgr, u, req, ptr(f.orgA))
	if !sameSet(names(kept), "Powerful,Plain") {
		t.Fatalf("kept: %s", names(kept))
	}
	// A role of a different organisation is not "kept" into this organisation.
	if strings.Contains(names(kept), "Scoped B") {
		t.Fatal("foreign-organisation role kept")
	}
	if got := testRules.KeepUnassignableRoles(boss, u, req, ptr(f.orgA)); len(got) != 1 {
		t.Fatalf("platform manager sets roles exactly: %s", names(got))
	}
	if testRules.HoldsNoMoreThan(mgr, u) {
		t.Fatal("org manager must not act on a more privileged account")
	}
	weak, _ := LoadUserByID(f.ctx, f.tx, f.user("weak", ptr(f.orgA), true, plain))
	if !testRules.HoldsNoMoreThan(mgr, weak) {
		t.Fatal("equal privileges must be allowed")
	}
}

func TestLastAdminGuard(t *testing.T) {
	f := newFx(t)
	check := func() error { return CheckAdminRemains(f.ctx, f.tx) }
	if err := check(); ruleStatus(err) != 0 {
		t.Fatalf("no admins at all must fail: %v", err)
	}
	// Admins that do not count: disabled, bound to an organisation, custom role.
	f.user("off", nil, false, f.roleAdmin)
	f.user("orgbound", ptr(f.orgA), true, f.roleAdmin)
	f.user("custom", nil, true, f.role("Staff", "platform", nil, AuditView))
	if err := check(); err == nil {
		t.Fatal("none of those is an active platform admin")
	}
	a := f.user("real", nil, true, f.roleAdmin)
	if err := check(); err != nil {
		t.Fatal(err)
	}
	// Two role links for one user count once.
	f.tx.Exec("INSERT INTO roles (\"key\", name, scope) VALUES ('platform_admin2','x','platform')")
	n, _ := ActivePlatformAdmins(f.ctx, f.tx)
	if n != 1 {
		t.Fatalf("count=%d", n)
	}
	f.tx.Exec("UPDATE users SET active = 0 WHERE id = ?", a)
	if err := check(); err == nil {
		t.Fatal("disabling the only admin must fail")
	}
}

func TestUniquenessAndNormalisation(t *testing.T) {
	f := newFx(t)
	f.org("Магазин «Ялинка»", true)
	if err := CheckUniqueOrganisation(f.ctx, f.tx, "  МАГАЗИН   «ЯЛИНКА» ", 0); err == nil || !strings.Contains(err.Error(), "(в архіві)") {
		t.Fatalf("case/space-insensitive duplicate (archived) not found: %v", err)
	}
	if err := CheckUniqueOrganisation(f.ctx, f.tx, "Shop A", f.orgA); err != nil {
		t.Fatal("renaming to itself must pass")
	}
	f.user("store1", nil, true)
	if err := CheckUniqueLogin(f.ctx, f.tx, "store1", 0); ruleStatus(err) != 0 {
		t.Fatal(err)
	}
	if err := CheckRoleName(f.ctx, f.tx, "ЛОГІСТ", nil, 0); err != nil {
		t.Fatal(err)
	}
	f.role("Логіст", "platform", nil)
	if err := CheckRoleName(f.ctx, f.tx, "ЛОГІСТ", nil, 0); err == nil {
		t.Fatal("role name duplicate (case-insensitive) not found")
	}
	if err := CheckRoleName(f.ctx, f.tx, "ЛОГІСТ", ptr(f.orgA), 0); err != nil {
		t.Fatal("same name in another organisation scope is allowed")
	}
	for in, ok := range map[string]bool{"ab": true, "a": false, "has space": false, "": false, strings.Repeat("x", 40): true, strings.Repeat("x", 41): false, "Ґрунт": true} {
		_, err := CleanLogin(in)
		if (err == nil) != ok {
			t.Errorf("CleanLogin(%q) ok=%v err=%v", in, ok, err)
		}
	}
	if l, _ := CleanLogin("  Store1 "); l != "store1" {
		t.Fatal(l)
	}
	if n, err := CleanName("  a   b ", "Назва"); n != "a b" || err != nil {
		t.Fatal(n, err)
	}
	if _, err := CleanName("   ", "Назва ролі"); err == nil || err.Error() != "Назва ролі не може бути порожньою" {
		t.Fatal(err)
	}
	if _, err := CleanName(strings.Repeat("я", 101), "Назва"); err == nil {
		t.Fatal("101 characters must fail")
	}
	if got := CleanFullName(strings.Repeat("я ", 80)); len([]rune(got)) != 100 {
		t.Fatal(len([]rune(got)))
	}
}

func TestValidatedPermissions(t *testing.T) {
	got, err := testRules.ValidatedPermissions("platform", []string{AuditView, UsersManage, AuditView})
	if err != nil || strings.Join(got, ",") != AuditView+","+UsersManage {
		t.Fatal(got, err)
	}
	if _, err := testRules.ValidatedPermissions("organisation", []string{"reports.submit", UsersManage}); err == nil ||
		!strings.Contains(err.Error(), UsersManage) {
		t.Fatalf("wrong-scope code accepted: %v", err)
	}
}

func TestEffectivePermissionsByScope(t *testing.T) {
	f := newFx(t)
	// A platform-scope role given to an organisation user grants nothing (scope mismatch).
	staff := f.role("Staff", "platform", nil, AuditView)
	p := f.principal(f.user("odd", ptr(f.orgA), true, staff))
	if len(p.Permissions) != 0 {
		t.Fatalf("%v", p.Permissions)
	}
	// Unknown stored codes are ignored.
	r := f.role("Weird", "organisation", nil, "reports.submit", "nonsense.code")
	p = f.principal(f.user("w", ptr(f.orgA), true, r))
	if len(p.Permissions) != 1 || !p.Permissions["reports.submit"] {
		t.Fatalf("%v", p.Permissions)
	}
	if lbl := p.User.RoleLabel(); lbl != "Weird" {
		t.Fatal(lbl)
	}
	none := f.principal(f.user("none", nil, true))
	if none.User.RoleLabel() != "без ролі" {
		t.Fatal(none.User.RoleLabel())
	}
}
