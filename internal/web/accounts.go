package web

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"legkyi/internal/core"
	"legkyi/internal/platform"
	"legkyi/internal/registry"
)

var anyAccountManager = []string{platform.UsersManage, platform.OrgUsersManage}

func (a *App) rules() platform.Rules { return platform.Rules{Codes: a.Registry.Codes} }

// --- DTOs (field order follows the Pydantic models) ----------------------------------

type permissionDTO struct {
	Code        string `json:"code"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Scope       string `json:"scope"`
	Module      string `json:"module"`
	ModuleTitle string `json:"module_title"`
}

type usageDTO []registry.UsageEntry

func (u usageDTO) MarshalJSON() ([]byte, error) {
	var b strings.Builder
	b.WriteByte('{')
	for i, e := range u {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(e.Module)
		b.Write(k)
		b.WriteByte(':')
		v, _ := json.Marshal(e.Count)
		b.Write(v)
	}
	b.WriteByte('}')
	return []byte(b.String()), nil
}

type organisationDTO struct {
	ID        int64    `json:"id"`
	Name      string   `json:"name"`
	Archived  bool     `json:"archived"`
	UserCount int      `json:"user_count"`
	Usage     usageDTO `json:"usage"`
}

type mutationDTO struct {
	ID       int64  `json:"id"`
	Archived bool   `json:"archived"`
	Deleted  bool   `json:"deleted"`
	Message  string `json:"message"`
}

type userDTO struct {
	ID           int64            `json:"id"`
	Login        string           `json:"login"`
	FullName     string           `json:"full_name"`
	Active       bool             `json:"active"`
	Organisation *organisationRef `json:"organisation"`
	RoleIDs      []int64          `json:"role_ids"`
	RoleNames    []string         `json:"role_names"`
}

type roleDTO struct {
	ID               int64    `json:"id"`
	Key              *string  `json:"key"`
	Name             string   `json:"name"`
	Scope            string   `json:"scope"`
	OrganisationID   *int64   `json:"organisation_id"`
	OrganisationName *string  `json:"organisation_name"`
	Permissions      []string `json:"permissions"`
	BuiltIn          bool     `json:"built_in"`
	AllPermissions   bool     `json:"all_permissions"`
	UserCount        int      `json:"user_count"`
}

func (a *App) mountAccounts(rt *Router) {
	all := append([]string{platform.RolesManage}, anyAccountManager...)
	rt.Handle("GET", "/permissions", a.authed(all, a.listPermissions))

	rt.Handle("GET", "/organisations", a.authed([]string{platform.OrganisationsManage, platform.UsersManage, platform.RolesManage}, a.listOrganisations))
	om := []string{platform.OrganisationsManage}
	rt.Handle("POST", "/organisations", a.authed(om, a.createOrganisation))
	rt.Handle("PUT", "/organisations/{oid}", a.authed(om, a.updateOrganisation))
	rt.Handle("DELETE", "/organisations/{oid}", a.authed(om, a.deleteOrganisation))
	rt.Handle("POST", "/organisations/{oid}/restore", a.authed(om, a.restoreOrganisation))

	rt.Handle("GET", "/users", a.authed(anyAccountManager, a.listUsers))
	rt.Handle("POST", "/users", a.authed(anyAccountManager, a.createUser))
	rt.Handle("PUT", "/users/{uid}", a.authed(anyAccountManager, a.updateUser))
	rt.Handle("PUT", "/users/{uid}/password", a.authed(anyAccountManager, a.resetUserPassword))
	rt.Handle("DELETE", "/users/{uid}", a.authed(anyAccountManager, a.deleteUser))

	rt.Handle("GET", "/roles", a.authed(all, a.listRoles))
	rm := []string{platform.RolesManage}
	rt.Handle("POST", "/roles", a.authed(rm, a.createRole))
	rt.Handle("PUT", "/roles/{rid}", a.authed(rm, a.updateRole))
	rt.Handle("DELETE", "/roles/{rid}", a.authed(rm, a.deleteRole))

	al := []string{platform.AuditView}
	rt.Handle("GET", "/admin/logs", a.authed(al, a.listLogs))
	rt.Handle("GET", "/admin/log-actions", a.authed(al, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		writeJSON(w, http.StatusOK, a.Registry.AuditActions())
		return nil
	}))
}

// --- permissions ---------------------------------------------------------------------

func (a *App) listPermissions(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	out := []permissionDTO{}
	for _, m := range a.Registry.Modules {
		for _, perm := range m.Permissions {
			out = append(out, permissionDTO{perm.Code, perm.Label, perm.Description, perm.Scope, m.Name, m.Title})
		}
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

// --- organisations -------------------------------------------------------------------

func (a *App) organisationDTOs(ctx context.Context, q core.Querier, only *int64) ([]organisationDTO, error) {
	counts := map[int64]int{}
	rows, err := q.QueryContext(ctx, "SELECT organisation_id, COUNT(id) FROM users WHERE organisation_id IS NOT NULL GROUP BY organisation_id")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			rows.Close()
			return nil, err
		}
		counts[id] = n
	}
	rows.Close()
	usage, err := a.Registry.OrganisationUsage(ctx, q)
	if err != nil {
		return nil, err
	}
	rows, err = q.QueryContext(ctx, "SELECT id, name, archived FROM organisations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []organisationDTO{}
	for rows.Next() {
		var d organisationDTO
		var arch int
		if err := rows.Scan(&d.ID, &d.Name, &arch); err != nil {
			return nil, err
		}
		if only != nil && d.ID != *only {
			continue
		}
		d.Archived, d.UserCount, d.Usage = arch != 0, counts[d.ID], usageDTO(usage[d.ID])
		out = append(out, d)
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, rows.Err()
}

func (a *App) oneOrganisation(ctx context.Context, q core.Querier, id int64) (organisationDTO, error) {
	l, err := a.organisationDTOs(ctx, q, &id)
	if err != nil || len(l) == 0 {
		return organisationDTO{}, err
	}
	return l[0], nil
}

func (a *App) listOrganisations(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	l, err := a.organisationDTOs(r.Context(), a.Store.R, nil)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, l)
	return nil
}

func (a *App) createOrganisation(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	rawName := body.String("name", 1, 100)
	fu := body.Object("first_user")
	var fuLogin, fuPass string
	if fu != nil {
		fuLogin, fuPass = fu.String("login", 2, 40), fu.String("password", platform.MinPasswordLength, 256)
	}
	if err := body.Err(); err != nil {
		return err
	}
	var hash string
	if fu != nil {
		if problem := platform.PasswordProblem(fuPass); problem != "" {
			return FormError{problem}
		}
		if hash, err = platform.HashPassword(fuPass, nil); err != nil {
			return err
		}
	}
	ip := a.Trusted.ClientIP(r)
	var newID int64
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		name, err := platform.CleanName(rawName, "Назва підрозділу")
		if err != nil {
			return err
		}
		if err := platform.CheckUniqueOrganisation(ctx, tx, name, 0); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, "INSERT INTO organisations (name, archived) VALUES (?, 0)", name)
		if err != nil {
			return uniqueConflict(err, "Підрозділ з такою назвою або логін уже існує.")
		}
		newID, _ = res.LastInsertId()
		detail := name
		if fu != nil {
			if !p.Can(platform.UsersManage) {
				return HTTPError{Status: 403, Detail: "Недостатньо прав для створення користувачів."}
			}
			login, err := platform.CleanLogin(fuLogin)
			if err != nil {
				return err
			}
			if err := platform.CheckUniqueLogin(ctx, tx, login, 0); err != nil {
				return err
			}
			var storeRole int64
			if err := tx.QueryRowContext(ctx, `SELECT id FROM roles WHERE "key" = 'store'`).Scan(&storeRole); err != nil {
				return err
			}
			if _, err := platform.CreateUser(tx, login, hash, &newID, a.now(), storeRole); err != nil {
				return uniqueConflict(err, "Підрозділ з такою назвою або логін уже існує.")
			}
			detail += " · логін " + login
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "додано підрозділ", detail)
	})
	if err != nil {
		return err
	}
	d, err := a.oneOrganisation(r.Context(), a.Store.R, newID)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, d)
	return nil
}

// uniqueConflict maps a SQLite UNIQUE violation to the 409 Python returned for IntegrityError.
func uniqueConflict(err error, detail string) error {
	if strings.Contains(err.Error(), "UNIQUE constraint failed") {
		return HTTPError{Status: 409, Detail: detail}
	}
	return err
}

func orgOr404(ctx context.Context, q core.Querier, id int64) (*platform.Organisation, error) {
	o, err := platform.LoadOrganisation(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, HTTPError{Status: 404, Detail: "Підрозділ не знайдено."}
	}
	return o, nil
}

func (a *App) updateOrganisation(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	oid := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	rawName := body.String("name", 1, 100)
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		org, err := orgOr404(ctx, tx, oid)
		if err != nil {
			return err
		}
		name, err := platform.CleanName(rawName, "Назва підрозділу")
		if err != nil {
			return err
		}
		if err := platform.CheckUniqueOrganisation(ctx, tx, name, oid); err != nil {
			return err
		}
		if org.Name != name {
			if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено підрозділ", "«"+org.Name+"» → «"+name+"»"); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE organisations SET name = ? WHERE id = ?", name, oid); err != nil {
				return uniqueConflict(err, "Підрозділ з такою назвою вже існує.")
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	d, err := a.oneOrganisation(r.Context(), a.Store.R, oid)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

func (a *App) deleteOrganisation(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	oid := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	ctx := r.Context()
	ip := a.Trusted.ClientIP(r)
	// Peek (outside the writer) to decide whether a before-delete backup is needed; the decision
	// is re-checked inside the write transaction.
	if _, err := orgOr404(ctx, a.Store.R, oid); err != nil {
		return err
	}
	usage, err := a.Registry.OrganisationUsage(ctx, a.Store.R)
	if err != nil {
		return err
	}
	if len(usage[oid]) == 0 && a.Backups != nil {
		if _, err := a.Backups.Run("before-delete"); err != nil {
			return err
		}
	}
	var out mutationDTO
	err = a.write(ctx, func(tx *sql.Tx) error {
		org, err := orgOr404(ctx, tx, oid)
		if err != nil {
			return err
		}
		usage, err := a.Registry.OrganisationUsage(ctx, tx)
		if err != nil {
			return err
		}
		if u := usage[oid]; len(u) > 0 {
			parts := make([]string, len(u))
			for i, e := range u {
				parts[i] = e.Module + ": " + itoa(e.Count)
			}
			if _, err := tx.ExecContext(ctx, "UPDATE organisations SET archived = 1 WHERE id = ?", oid); err != nil {
				return err
			}
			if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "архівовано підрозділ", org.Name+" · "+strings.Join(parts, ", ")); err != nil {
				return err
			}
			out = mutationDTO{ID: oid, Archived: true, Message: "«" + org.Name + "» переміщено в архів. Дані збережено."}
			return nil
		}
		// Child rows are deleted explicitly: legacy-migrated databases may lack ON DELETE CASCADE.
		for _, q := range []string{
			"DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE organisation_id = ?)",
			"DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE organisation_id = ?)",
			"DELETE FROM users WHERE organisation_id = ?",
			"DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE organisation_id = ?)",
			"DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organisation_id = ?)",
			"DELETE FROM roles WHERE organisation_id = ?",
			"DELETE FROM report_settings WHERE organisation_id = ?",
			"DELETE FROM organisations WHERE id = ?",
		} {
			if _, err := tx.ExecContext(ctx, q, oid); err != nil {
				return err
			}
		}
		if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "видалено підрозділ", org.Name); err != nil {
			return err
		}
		out = mutationDTO{ID: oid, Deleted: true, Message: "Підрозділ «" + org.Name + "» остаточно видалено."}
		return nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) restoreOrganisation(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	oid := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	err := a.write(r.Context(), func(tx *sql.Tx) error {
		org, err := orgOr404(r.Context(), tx, oid)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), "UPDATE organisations SET archived = 0 WHERE id = ?", oid); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "відновлено підрозділ", org.Name)
	})
	if err != nil {
		return err
	}
	d, err := a.oneOrganisation(r.Context(), a.Store.R, oid)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

// --- users ---------------------------------------------------------------------------

func (a *App) userDTOs(ctx context.Context, q core.Querier, where string, args ...any) ([]userDTO, error) {
	rows, err := q.QueryContext(ctx, `SELECT u.id, u.login, u.full_name, u.active, o.id, o.name FROM users u
		LEFT JOIN organisations o ON o.id = u.organisation_id `+where+` ORDER BY u.login`, args...)
	if err != nil {
		return nil, err
	}
	out := []userDTO{}
	idx := map[int64]int{}
	for rows.Next() {
		var d userDTO
		var active int
		var oid sql.NullInt64
		var oname sql.NullString
		if err := rows.Scan(&d.ID, &d.Login, &d.FullName, &active, &oid, &oname); err != nil {
			rows.Close()
			return nil, err
		}
		d.Active, d.RoleIDs, d.RoleNames = active != 0, []int64{}, []string{}
		if oid.Valid {
			d.Organisation = &organisationRef{oid.Int64, oname.String}
		}
		idx[d.ID] = len(out)
		out = append(out, d)
	}
	rows.Close()
	if len(out) == 0 {
		return out, nil
	}
	rr, err := q.QueryContext(ctx, "SELECT ur.user_id, r.id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id")
	if err != nil {
		return nil, err
	}
	defer rr.Close()
	for rr.Next() {
		var uid, rid int64
		var name string
		if err := rr.Scan(&uid, &rid, &name); err != nil {
			return nil, err
		}
		if i, ok := idx[uid]; ok {
			out[i].RoleIDs = append(out[i].RoleIDs, rid)
			out[i].RoleNames = append(out[i].RoleNames, name)
		}
	}
	for i := range out {
		sort.Slice(out[i].RoleIDs, func(x, y int) bool { return out[i].RoleIDs[x] < out[i].RoleIDs[y] })
		sort.Strings(out[i].RoleNames)
	}
	return out, rr.Err()
}

func (a *App) oneUser(ctx context.Context, q core.Querier, id int64) (userDTO, error) {
	l, err := a.userDTOs(ctx, q, "WHERE u.id = ?", id)
	if err != nil || len(l) == 0 {
		return userDTO{}, err
	}
	return l[0], nil
}

func (a *App) listUsers(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	orgFilter := pm.OptInt("organisation_id")
	platformOnly := pm.Bool("platform", false)
	if err := pm.Err(); err != nil {
		return err
	}
	limit, err := platform.ManagedOrganisation(p)
	if err != nil {
		return err
	}
	where, args := "", []any{}
	switch {
	case limit != nil:
		where, args = "WHERE u.organisation_id = ?", []any{*limit}
	case platformOnly:
		where = "WHERE u.organisation_id IS NULL"
	case orgFilter != nil:
		where, args = "WHERE u.organisation_id = ?", []any{*orgFilter}
	}
	l, err := a.userDTOs(r.Context(), a.Store.R, where, args...)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, l)
	return nil
}

func roleNames(roles []platform.Role) string {
	n := make([]string, len(roles))
	for i, r := range roles {
		n[i] = r.Name
	}
	return strings.Join(n, ", ")
}

func (a *App) createUser(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	rawLogin := body.String("login", 2, 40)
	password := body.String("password", platform.MinPasswordLength, 256)
	fullName := body.OptString("full_name", "", 100)
	orgID := body.OptInt("organisation_id")
	roleIDs := body.IntList("role_ids", 50)
	active := body.OptBool("active", true)
	if err := body.Err(); err != nil {
		return err
	}
	if problem := platform.PasswordProblem(password); problem != "" {
		return FormError{problem}
	}
	hash, err := platform.HashPassword(password, nil)
	if err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	var newID int64
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		org, err := platform.ResolveTargetOrganisation(ctx, tx, p, orgID)
		if err != nil {
			return err
		}
		login, err := platform.CleanLogin(rawLogin)
		if err != nil {
			return err
		}
		if err := platform.CheckUniqueLogin(ctx, tx, login, 0); err != nil {
			return err
		}
		var oid *int64
		orgLabel := "платформа"
		if org != nil {
			oid, orgLabel = &org.ID, org.Name
		}
		roles, err := a.rules().ResolveRoles(ctx, tx, p, oid, roleIDs)
		if err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx,
			"INSERT INTO users (login, password_hash, full_name, active, organisation_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			login, hash, platform.CleanFullName(fullName), boolInt(active), oid, a.now().UTC().Format(platform.SQLTimeFormat))
		if err != nil {
			return uniqueConflict(err, "Такий логін уже існує.")
		}
		newID, _ = res.LastInsertId()
		for _, role := range roles {
			if _, err := tx.ExecContext(ctx, "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", newID, role.ID); err != nil {
				return err
			}
		}
		names := roleNames(roles)
		if names == "" {
			names = "без ролі"
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "додано користувача", login+" · "+orgLabel+" · "+names)
	})
	if err != nil {
		return err
	}
	d, err := a.oneUser(r.Context(), a.Store.R, newID)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, d)
	return nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func userOr404(ctx context.Context, q core.Querier, p *platform.Principal, uid int64) (*platform.User, error) {
	u, err := platform.LoadUserByID(ctx, q, uid)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, HTTPError{Status: 404, Detail: "Користувача не знайдено."}
	}
	if err := platform.CheckCanManageUser(p, u); err != nil {
		return nil, err
	}
	return u, nil
}

func (a *App) updateUser(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	uid := pm.PathInt("uid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	rawLogin := body.String("login", 2, 40)
	fullName := body.OptString("full_name", "", 100)
	orgID := body.OptInt("organisation_id")
	roleIDs := body.IntList("role_ids", 50)
	active := body.OptBool("active", true)
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		user, err := userOr404(ctx, tx, p, uid)
		if err != nil {
			return err
		}
		org, err := platform.ResolveTargetOrganisation(ctx, tx, p, orgID)
		if err != nil {
			return err
		}
		var newOrg *int64
		orgLabel := "платформа"
		if org != nil {
			newOrg, orgLabel = &org.ID, org.Name
		}
		login, err := platform.CleanLogin(rawLogin)
		if err != nil {
			return err
		}
		if err := platform.CheckUniqueLogin(ctx, tx, login, uid); err != nil {
			return err
		}
		rules := a.rules()
		requested, err := rules.ResolveRoles(ctx, tx, p, newOrg, roleIDs)
		if err != nil {
			return err
		}
		roles := rules.KeepUnassignableRoles(p, user, requested, newOrg)
		if user.ID == p.User.ID && !active {
			return platform.RuleError{Msg: "Не можна вимкнути власний обліковий запис."}
		}
		var notes []string
		oldLogin := user.Login
		if user.Login != login {
			notes = append(notes, "логін "+user.Login+" → "+login)
		}
		name := platform.CleanFullName(fullName)
		if user.FullName != name {
			notes = append(notes, "змінено ім'я")
		}
		if !sameOrgID(user.Org, newOrg) {
			notes = append(notes, "підрозділ → "+orgLabel)
		}
		if user.Active != active {
			if active {
				notes = append(notes, "увімкнено")
			} else {
				notes = append(notes, "вимкнено")
				if err := endUserSessions(tx, uid); err != nil { // a disabled account is signed out everywhere
					return err
				}
			}
		}
		if !sameRoleSet(user.Roles, roles) {
			sorted := make([]string, len(roles))
			for i, ro := range roles {
				sorted[i] = ro.Name
			}
			sort.Strings(sorted)
			list := strings.Join(sorted, ", ")
			if list == "" {
				list = "немає"
			}
			notes = append(notes, "ролі: "+list)
		}
		_ = oldLogin
		if _, err := tx.ExecContext(ctx, "UPDATE users SET login = ?, full_name = ?, organisation_id = ?, active = ? WHERE id = ?",
			login, name, newOrg, boolInt(active), uid); err != nil {
			return uniqueConflict(err, "Такий логін уже існує.")
		}
		if !sameRoleSet(user.Roles, roles) {
			if _, err := tx.ExecContext(ctx, "DELETE FROM user_roles WHERE user_id = ?", uid); err != nil {
				return err
			}
			for _, ro := range roles {
				if _, err := tx.ExecContext(ctx, "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, ro.ID); err != nil {
					return err
				}
			}
		}
		if err := platform.CheckAdminRemains(ctx, tx); err != nil {
			return err
		}
		if len(notes) > 0 {
			return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено користувача", login+": "+strings.Join(notes, "; "))
		}
		return nil
	})
	if err != nil {
		return err
	}
	d, err := a.oneUser(r.Context(), a.Store.R, uid)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

func sameOrgID(o *platform.Organisation, id *int64) bool {
	if o == nil || id == nil {
		return o == nil && id == nil
	}
	return o.ID == *id
}

func sameRoleSet(a, b []platform.Role) bool {
	if len(a) != len(b) {
		return false
	}
	m := map[int64]bool{}
	for _, r := range a {
		m[r.ID] = true
	}
	for _, r := range b {
		if !m[r.ID] {
			return false
		}
	}
	return true
}

func (a *App) resetUserPassword(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	uid := pm.PathInt("uid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	pw := body.String("password", platform.MinPasswordLength, 256)
	if err := body.Err(); err != nil {
		return err
	}
	if problem := platform.PasswordProblem(pw); problem != "" {
		return FormError{problem}
	}
	hash, err := platform.HashPassword(pw, nil)
	if err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	var login string
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		user, err := userOr404(ctx, tx, p, uid)
		if err != nil {
			return err
		}
		if !p.Can(platform.UsersManage) && !a.rules().HoldsNoMoreThan(p, user) {
			return HTTPError{Status: 403, Detail: "Недостатньо прав для зміни цього пароля."}
		}
		login = user.Login
		if _, err := tx.ExecContext(ctx, "UPDATE users SET password_hash = ? WHERE id = ?", hash, uid); err != nil {
			return err
		}
		if err := endUserSessions(tx, uid); err != nil { // a reset signs the user out everywhere
			return err
		}
		// Passkeys go too: one registered from a hijacked session must not survive the reset.
		if _, err := tx.ExecContext(ctx, "DELETE FROM passkeys WHERE user_id = ?", uid); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено пароль користувача", login)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, messageDTO{"Пароль для «" + login + "» змінено."})
	return nil
}

func (a *App) deleteUser(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	uid := pm.PathInt("uid")
	if err := pm.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	var login string
	err := a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		user, err := userOr404(ctx, tx, p, uid)
		if err != nil {
			return err
		}
		if user.ID == p.User.ID {
			return platform.RuleError{Msg: "Не можна видалити власний обліковий запис."}
		}
		if !p.Can(platform.UsersManage) && !a.rules().HoldsNoMoreThan(p, user) {
			return HTTPError{Status: 403, Detail: "Недостатньо прав для видалення цього користувача."}
		}
		login = user.Login
		// Role links are removed explicitly (this also fixes Python's 500 for users that hold roles).
		if _, err := tx.ExecContext(ctx, "DELETE FROM user_roles WHERE user_id = ?", uid); err != nil {
			return err
		}
		if err := endUserSessions(tx, uid); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM users WHERE id = ?", uid); err != nil {
			return err
		}
		if err := platform.CheckAdminRemains(ctx, tx); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "видалено користувача", login)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, mutationDTO{ID: uid, Deleted: true, Message: "Користувача «" + login + "» видалено."})
	return nil
}

// --- roles ---------------------------------------------------------------------------

func (a *App) roleDTOs(ctx context.Context, q core.Querier, roles []platform.Role) ([]roleDTO, error) {
	counts := map[int64]int{}
	rows, err := q.QueryContext(ctx, "SELECT role_id, COUNT(user_id) FROM user_roles GROUP BY role_id")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			rows.Close()
			return nil, err
		}
		counts[id] = n
	}
	rows.Close()
	names := map[int64]string{}
	rows, err = q.QueryContext(ctx, "SELECT id, name FROM organisations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var n string
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		names[id] = n
	}
	rules := a.rules()
	out := make([]roleDTO, 0, len(roles))
	for _, ro := range roles {
		d := roleDTO{ID: ro.ID, Name: ro.Name, Scope: ro.Scope, OrganisationID: ro.OrgID, Permissions: []string{},
			BuiltIn: ro.Key != "", UserCount: counts[ro.ID]}
		if ro.Key != "" {
			k := ro.Key
			d.Key = &k
			_, d.AllPermissions = platform.AllOfScope[ro.Key]
		}
		if ro.OrgID != nil {
			if n, ok := names[*ro.OrgID]; ok {
				d.OrganisationName = &n
			}
		}
		for c := range rules.RolePermissions(ro) {
			d.Permissions = append(d.Permissions, c)
		}
		sort.Strings(d.Permissions)
		out = append(out, d)
	}
	return out, rows.Err()
}

func (a *App) listRoles(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	orgFilter := pm.OptInt("organisation_id")
	if err := pm.Err(); err != nil {
		return err
	}
	ctx := r.Context()
	var roles []platform.Role
	var err error
	if p.Can(platform.RolesManage, platform.UsersManage) && orgFilter == nil {
		roles, err = platform.LoadRoles(ctx, a.Store.R, "")
	} else {
		target := orgFilter
		if !p.Can(platform.UsersManage) {
			if target, err = platform.ManagedOrganisation(p); err != nil {
				return err
			}
		}
		roles, err = a.rules().AssignableRoles(ctx, a.Store.R, p, target)
	}
	if err != nil {
		return err
	}
	sort.SliceStable(roles, func(i, j int) bool {
		x, y := roles[i], roles[j]
		if (x.Scope != "platform") != (y.Scope != "platform") {
			return x.Scope == "platform"
		}
		if (x.Key == "") != (y.Key == "") {
			return x.Key != ""
		}
		return strings.ToLower(x.Name) < strings.ToLower(y.Name)
	})
	out, err := a.roleDTOs(ctx, a.Store.R, roles)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) oneRole(ctx context.Context, q core.Querier, id int64) (roleDTO, error) {
	roles, err := platform.LoadRoles(ctx, q, "WHERE r.id = ?", id)
	if err != nil || len(roles) == 0 {
		return roleDTO{}, err
	}
	l, err := a.roleDTOs(ctx, q, roles)
	if err != nil || len(l) == 0 {
		return roleDTO{}, err
	}
	return l[0], nil
}

func (a *App) createRole(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	rawName := body.String("name", 1, 100)
	orgID := body.OptInt("organisation_id")
	// A role is a plain set of permissions; "scope" is accepted for old clients and only records whether the role
	// was made for one division.
	scope := body.OptLiteral("scope", "", "platform", "organisation")
	if scope == "" {
		scope = "platform"
		if orgID != nil {
			scope = "organisation"
		}
	}
	perms := body.StringList("permissions", 500)
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	var newID int64
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		name, err := platform.CleanName(rawName, "Назва ролі")
		if err != nil {
			return err
		}
		oid := orgID
		if oid != nil {
			if _, err := orgOr404(ctx, tx, *oid); err != nil {
				return err
			}
		}
		if err := platform.CheckRoleName(ctx, tx, name, oid, 0); err != nil {
			return err
		}
		codes, err := a.rules().ValidatedPermissions(scope, perms)
		if err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, "INSERT INTO roles (name, scope, organisation_id) VALUES (?, ?, ?)", name, scope, oid)
		if err != nil {
			return err
		}
		newID, _ = res.LastInsertId()
		for _, c := range codes {
			if _, err := tx.ExecContext(ctx, "INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)", newID, c); err != nil {
				return err
			}
		}
		list := strings.Join(codes, ", ")
		if list == "" {
			list = "—"
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "додано роль", name+": "+list)
	})
	if err != nil {
		return err
	}
	d, err := a.oneRole(r.Context(), a.Store.R, newID)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, d)
	return nil
}

func roleOr404(ctx context.Context, q core.Querier, id int64) (*platform.Role, error) {
	roles, err := platform.LoadRoles(ctx, q, "WHERE r.id = ?", id)
	if err != nil {
		return nil, err
	}
	if len(roles) == 0 {
		return nil, HTTPError{Status: 404, Detail: "Роль не знайдено."}
	}
	return &roles[0], nil
}

func (a *App) updateRole(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	rid := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	rawName := body.String("name", 1, 100)
	orgID := body.OptInt("organisation_id")
	_ = body.OptLiteral("scope", "", "platform", "organisation") // accepted, no longer meaningful
	perms := body.StringList("permissions", 500)
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		role, err := roleOr404(ctx, tx, rid)
		if err != nil {
			return err
		}
		name, err := platform.CleanName(rawName, "Назва ролі")
		if err != nil {
			return err
		}
		oid := role.OrgID
		if role.Key == "" {
			oid = orgID
		}
		if oid != nil {
			if _, err := orgOr404(ctx, tx, *oid); err != nil {
				return err
			}
		}
		if !sameInt64Ptr(oid, role.OrgID) && oid != nil {
			var elsewhere int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(u.id) FROM users u JOIN user_roles ur ON ur.user_id = u.id
				WHERE ur.role_id = ? AND u.organisation_id != ?`, rid, *oid).Scan(&elsewhere); err != nil {
				return err
			}
			if elsewhere > 0 {
				return platform.RuleError{Msg: "Роль призначено користувачам інших підрозділів; спершу зніміть її з них."}
			}
		}
		if err := platform.CheckRoleName(ctx, tx, name, oid, rid); err != nil {
			return err
		}
		var notes []string
		if role.Name != name {
			notes = append(notes, "назва «"+role.Name+"» → «"+name+"»")
		}
		if _, err := tx.ExecContext(ctx, "UPDATE roles SET name = ?, organisation_id = ? WHERE id = ?", name, oid, rid); err != nil {
			return err
		}
		if _, all := platform.AllOfScope[role.Key]; !all {
			codes, err := a.rules().ValidatedPermissions(role.Scope, perms)
			if err != nil {
				return err
			}
			current := append([]string(nil), role.Grants...)
			sort.Strings(current)
			if strings.Join(current, "\x00") != strings.Join(codes, "\x00") {
				if _, err := tx.ExecContext(ctx, "DELETE FROM role_permissions WHERE role_id = ?", rid); err != nil {
					return err
				}
				for _, c := range codes {
					if _, err := tx.ExecContext(ctx, "INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)", rid, c); err != nil {
						return err
					}
				}
				list := strings.Join(codes, ", ")
				if list == "" {
					list = "—"
				}
				notes = append(notes, "дозволи: "+list)
			}
		}
		if len(notes) > 0 {
			return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено роль", name+": "+strings.Join(notes, "; "))
		}
		return nil
	})
	if err != nil {
		return err
	}
	d, err := a.oneRole(r.Context(), a.Store.R, rid)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

func sameInt64Ptr(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func (a *App) deleteRole(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	rid := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	var name string
	err := a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		role, err := roleOr404(ctx, tx, rid)
		if err != nil {
			return err
		}
		if role.Key != "" {
			return platform.RuleError{Msg: "Вбудовану роль видалити не можна."}
		}
		name = role.Name
		for _, q := range []string{
			"DELETE FROM user_roles WHERE role_id = ?",
			"DELETE FROM role_permissions WHERE role_id = ?",
			"DELETE FROM roles WHERE id = ?",
		} {
			if _, err := tx.ExecContext(ctx, q, rid); err != nil {
				return err
			}
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "видалено роль", name)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, mutationDTO{ID: rid, Deleted: true, Message: "Роль «" + name + "» видалено."})
	return nil
}

// --- audit log -----------------------------------------------------------------------

type auditLogDTO struct {
	ID     int64  `json:"id"`
	TS     string `json:"ts"`
	Login  string `json:"login"`
	Role   string `json:"role"`
	Action string `json:"action"`
	Detail string `json:"detail"`
	IP     string `json:"ip"`
}

var storedTimeLayouts = []string{
	"2006-01-02 15:04:05.999999999", "2006-01-02T15:04:05.999999999", "2006-01-02 15:04:05",
	"2006-01-02T15:04:05Z07:00", "2006-01-02 15:04:05Z07:00", "2006-01-02T15:04:05.999999999Z07:00",
}

// ServedTime turns stored naive-UTC text into RFC3339 UTC with "Z" (Q5). Python dropped a zero
// fraction, so does this; unparseable legacy values are returned unchanged.
func ServedTime(stored string) string {
	for _, l := range storedTimeLayouts {
		if t, err := time.Parse(l, stored); err == nil {
			t = t.UTC()
			if t.Nanosecond() == 0 {
				return t.Format("2006-01-02T15:04:05Z")
			}
			return t.Format("2006-01-02T15:04:05.000000Z")
		}
	}
	return stored
}

func (a *App) listLogs(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	login, action := pm.String("login"), pm.String("action")
	limit := pm.Int("limit", 200, 1, 500)
	if err := pm.Err(); err != nil {
		return err
	}
	q := "SELECT id, CAST(ts AS TEXT), login, role, action, detail, ip FROM audit_log"
	var conds []string
	var args []any
	if login != "" {
		conds = append(conds, "login LIKE '%' || ? || '%'")
		args = append(args, strings.ToLower(strings.TrimSpace(login)))
	}
	if action != "" {
		conds = append(conds, "action = ?")
		args = append(args, action)
	}
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	rows, err := a.Store.R.QueryContext(r.Context(), q+" ORDER BY id DESC LIMIT ?", append(args, limit)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []auditLogDTO{}
	for rows.Next() {
		var d auditLogDTO
		if err := rows.Scan(&d.ID, &d.TS, &d.Login, &d.Role, &d.Action, &d.Detail, &d.IP); err != nil {
			return err
		}
		d.TS = ServedTime(d.TS)
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}
