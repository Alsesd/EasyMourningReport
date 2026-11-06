package web

import (
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"legkyi/internal/platform"
	"legkyi/internal/system"
	"legkyi/internal/update"
)

type backupDTO struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"size_bytes"`
	CreatedAt string `json:"created_at"`
}

type healthDTO struct {
	DatabaseOK        bool    `json:"database_ok"`
	Integrity         string  `json:"integrity"`
	JournalMode       string  `json:"journal_mode"`
	DatabaseSizeBytes int64   `json:"database_size_bytes"`
	BackupsCount      int     `json:"backups_count"`
	LastBackupAt      *string `json:"last_backup_at"`
	BackupEveryMin    int     `json:"backup_every_min"`
}

// servedTimeOf renders a time as RFC3339 UTC with Z, with microseconds only when non-zero (Pydantic).
func servedTimeOf(t time.Time) string {
	t = t.UTC()
	if t.Nanosecond() == 0 {
		return t.Format("2006-01-02T15:04:05Z")
	}
	return t.Format("2006-01-02T15:04:05.000000Z")
}

func (a *App) healthDTO() healthDTO {
	h := system.ReadHealth(a.Store, a.Backups, a.BackupEveryMin)
	d := healthDTO{h.DatabaseOK, h.Integrity, h.JournalMode, h.DatabaseSize, h.BackupsCount, nil, h.BackupEveryMin}
	if h.LastBackupAt != nil {
		s := servedTimeOf(*h.LastBackupAt)
		d.LastBackupAt = &s
	}
	return d
}

func (a *App) mountSystem(rt *Router) {
	sm := []string{platform.SystemManage}
	rt.Handle("GET", "/admin/tunnel", a.authed(sm, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		writeJSON(w, http.StatusOK, a.Tunnel.Status())
		return nil
	}))
	rt.Handle("POST", "/admin/tunnel", a.authed(sm, a.startTunnel))
	rt.Handle("PUT", "/admin/tunnel/autostart", a.authed(sm, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		body, err := ReadBody(r)
		if err != nil {
			return err
		}
		enabled := body.Bool("enabled")
		if err := body.Err(); err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, a.Tunnel.SetAutostart(enabled))
		return nil
	}))
	rt.Handle("DELETE", "/admin/tunnel", a.authed(sm, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		st := a.Tunnel.Stop()
		if err := a.audit(r, a.Trusted.ClientIP(r), p.User.Login, p.User.RoleLabel(), "вимкнено публічний доступ", ""); err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, st)
		return nil
	}))
	rt.Handle("GET", "/admin/backups", a.authed(sm, a.listBackups))
	rt.Handle("GET", "/admin/system/health", a.authed(sm, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		writeJSON(w, http.StatusOK, a.healthDTO())
		return nil
	}))
	rt.Handle("GET", "/admin/backup/download", a.authed(sm, a.downloadBackup))
	rt.Handle("GET", "/admin/overview", a.authed(nil, a.overview))
	rt.Handle("GET", "/admin/update", a.authed(sm, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		writeJSON(w, http.StatusOK, a.updateStatus())
		return nil
	}))
	rt.Handle("POST", "/admin/update/check", a.authed(sm, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		if a.Updater == nil || !a.Updater.Enabled() {
			return HTTPError{Status: 409, Detail: "Це не релізна збірка: автоматичне оновлення недоступне."}
		}
		writeJSON(w, http.StatusOK, a.Updater.Check(r.Context()))
		return nil
	}))
	rt.Handle("POST", "/admin/update/apply", a.authed(sm, a.applyUpdate))
}

func (a *App) updateStatus() update.Status {
	if a.Updater == nil {
		return update.Status{State: "idle"}
	}
	return a.Updater.Status()
}

// applyUpdate installs the newest release and restarts the program; the browser reconnects by itself.
func (a *App) applyUpdate(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	if a.Updater == nil || !a.Updater.Enabled() {
		return HTTPError{Status: 409, Detail: "Це не релізна збірка: автоматичне оновлення недоступне."}
	}
	a.Updater.Check(r.Context())
	st := a.Updater.Status()
	if !st.Available {
		return HTTPError{Status: 409, Detail: "Новішої версії немає."}
	}
	if err := a.audit(r, a.Trusted.ClientIP(r), p.User.Login, p.User.RoleLabel(), "оновлення програми", st.Current+" → "+st.Latest); err != nil {
		return err
	}
	// The request must not be tied to the connection: the response is written before the restart begins.
	if err := a.Updater.Apply(context.WithoutCancel(r.Context())); err != nil {
		return HTTPError{Status: 502, Detail: err.Error()}
	}
	writeJSON(w, http.StatusOK, a.Updater.Status())
	return nil
}

func (a *App) startTunnel(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	confirm := body.Bool("confirm_public")
	autostart := body.OptBool("autostart", true)
	token := body.OptString("token", "", 4096)
	if err := body.Err(); err != nil {
		return err
	}
	if !confirm {
		return HTTPError{Status: 400, Detail: "Підтвердьте, що тунель відкриває застосунок для публічного доступу."}
	}
	st := a.Tunnel.Start(token, autostart)
	if st.State == "error" {
		detail := st.Error
		if detail == "" {
			detail = "Тунель не запустився."
		}
		return HTTPError{Status: 503, Detail: detail}
	}
	detail := ""
	if token != "" {
		detail = "новий токен"
	}
	if err := a.audit(r, a.Trusted.ClientIP(r), p.User.Login, p.User.RoleLabel(), "увімкнено публічний доступ", detail); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, st)
	return nil
}

func (a *App) listBackups(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	limit := int64(20)
	if v := pm.OptInt("limit"); v != nil {
		limit = *v
	}
	if err := pm.Err(); err != nil {
		return err
	}
	limit = max(1, min(limit, 200))
	out := []backupDTO{}
	if a.Backups != nil {
		for _, path := range a.Backups.List() {
			if int64(len(out)) >= limit {
				break
			}
			fi, err := os.Stat(path)
			if err != nil {
				continue
			}
			out = append(out, backupDTO{filepath.Base(path), fi.Size(), servedTimeOf(fi.ModTime())})
		}
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

// downloadBackup takes a fresh verified snapshot (outside the writer) and streams it.
func (a *App) downloadBackup(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	fail500 := HTTPError{Status: 500, Detail: "Не вдалося створити резервну копію бази даних"}
	if a.Backups == nil {
		return fail500
	}
	path, err := a.Backups.Run("snapshot")
	if err != nil {
		return HTTPError{Status: 500, Detail: err.Error()}
	}
	if path == "" {
		return fail500
	}
	f, err := os.Open(path)
	if err != nil {
		return fail500
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return fail500
	}
	if err := a.audit(r, a.Trusted.ClientIP(r), p.User.Login, p.User.RoleLabel(), "завантажено бекап", filepath.Base(path)); err != nil {
		// A logging failure must not turn a successfully created backup into a failed download.
		log.Printf("could not record the backup download in the audit log: %v", err)
	}
	// A big database through a slow tunnel must not hit a server write timeout.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(path)+`"`)
	w.Header().Set("Content-Length", itoa(int(fi.Size())))
	_, err = io.Copy(w, f)
	return err
}

// --- overview --------------------------------------------------------------------------------

type accountsSummaryDTO struct {
	Organisations         int `json:"organisations"`
	ArchivedOrganisations int `json:"archived_organisations"`
	Users                 int `json:"users"`
	InactiveUsers         int `json:"inactive_users"`
	Roles                 int `json:"roles"`
}

type overviewStatDTO struct {
	Label   string `json:"label"`
	Value   string `json:"value"`
	Hint    string `json:"hint"`
	Section string `json:"section"`
}

type moduleOverviewDTO struct {
	Module string            `json:"module"`
	Title  string            `json:"title"`
	Stats  []overviewStatDTO `json:"stats"`
}

type adminOverviewDTO struct {
	Accounts       *accountsSummaryDTO  `json:"accounts"`
	Tunnel         *system.TunnelStatus `json:"tunnel"`
	Health         *healthDTO           `json:"health"`
	RecentActivity []auditLogDTO        `json:"recent_activity"`
	Modules        []moduleOverviewDTO  `json:"modules"`
}

func (a *App) accountsSummary(r *http.Request, p *platform.Principal) (*accountsSummaryDTO, error) {
	q := a.Store.R
	n := func(query string, args ...any) (int, error) {
		var c int
		err := q.QueryRowContext(r.Context(), query, args...).Scan(&c)
		return c, err
	}
	var d accountsSummaryDTO
	var err error
	switch {
	case p.Can(platform.UsersManage, platform.OrganisationsManage, platform.RolesManage):
		if d.Organisations, err = n("SELECT COUNT(*) FROM organisations WHERE archived = 0"); err != nil {
			return nil, err
		}
		if d.ArchivedOrganisations, err = n("SELECT COUNT(*) FROM organisations WHERE archived = 1"); err != nil {
			return nil, err
		}
		if d.Users, err = n("SELECT COUNT(*) FROM users"); err != nil {
			return nil, err
		}
		if d.InactiveUsers, err = n("SELECT COUNT(*) FROM users WHERE active = 0"); err != nil {
			return nil, err
		}
		if d.Roles, err = n("SELECT COUNT(*) FROM roles"); err != nil {
			return nil, err
		}
	case p.Can(platform.OrgUsersManage) && p.OrganisationID() != nil:
		org := *p.OrganisationID()
		d.Organisations = 1
		if d.Users, err = n("SELECT COUNT(*) FROM users WHERE organisation_id = ?", org); err != nil {
			return nil, err
		}
		if d.InactiveUsers, err = n("SELECT COUNT(*) FROM users WHERE organisation_id = ? AND active = 0", org); err != nil {
			return nil, err
		}
	default:
		return nil, nil
	}
	return &d, nil
}

// overview shows everything the caller may see; sections without permission stay null.
func (a *App) overview(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	ctx := r.Context()
	res := adminOverviewDTO{Modules: []moduleOverviewDTO{}}
	var err error
	if res.Accounts, err = a.accountsSummary(r, p); err != nil {
		return err
	}
	if p.Can(platform.SystemManage) {
		st := a.Tunnel.Status()
		res.Tunnel = &st
		h := a.healthDTO()
		res.Health = &h
	}
	if p.Can(platform.AuditView) {
		rows, err := a.Store.R.QueryContext(ctx, "SELECT id, CAST(ts AS TEXT), login, role, action, detail, ip FROM audit_log ORDER BY id DESC LIMIT 6")
		if err != nil {
			return err
		}
		res.RecentActivity = []auditLogDTO{}
		for rows.Next() {
			var d auditLogDTO
			if err := rows.Scan(&d.ID, &d.TS, &d.Login, &d.Role, &d.Action, &d.Detail, &d.IP); err != nil {
				rows.Close()
				return err
			}
			d.TS = ServedTime(d.TS)
			res.RecentActivity = append(res.RecentActivity, d)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}
	for _, m := range a.Registry.Modules {
		if m.Overview == nil {
			continue
		}
		stats, err := m.Overview(ctx, a.Store.R, p.Can, a.currentPeriod())
		if err != nil {
			return err
		}
		if len(stats) == 0 {
			continue
		}
		mo := moduleOverviewDTO{Module: m.Name, Title: m.Title, Stats: []overviewStatDTO{}}
		for _, s := range stats {
			mo.Stats = append(mo.Stats, overviewStatDTO(s))
		}
		res.Modules = append(res.Modules, mo)
	}
	writeJSON(w, http.StatusOK, res)
	return nil
}
