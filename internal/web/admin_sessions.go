package web

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"legkyi/internal/platform"
)

// The administrators' session list: every signed-in device of every employee, with who, where from and since
// when, and the power to end one session or all sessions of a user. Held by platform.users.manage.

type adminSessionDTO struct {
	ID           int64            `json:"id"`
	UserID       int64            `json:"user_id"`
	Login        string           `json:"login"`
	FullName     string           `json:"full_name"`
	Organisation *organisationRef `json:"organisation"`
	Active       bool             `json:"active"`
	Device       string           `json:"device"`
	IP           string           `json:"ip"`
	CreatedAt    string           `json:"created_at"`
	LastSeen     string           `json:"last_seen"`
	Current      bool             `json:"current"`
}

// deviceLabel turns a User-Agent into "Chrome · Windows" (nothing more is kept or shown).
func deviceLabel(ua string) string {
	browser, system := "Невідомий браузер", ""
	for _, b := range []struct{ token, name string }{
		{"Edg/", "Edge"}, {"OPR/", "Opera"}, {"Firefox/", "Firefox"}, {"SamsungBrowser/", "Samsung Internet"},
		{"Chrome/", "Chrome"}, {"Safari/", "Safari"},
	} {
		if strings.Contains(ua, b.token) {
			browser = b.name
			break
		}
	}
	for _, o := range []struct{ token, name string }{
		{"Windows", "Windows"}, {"Android", "Android"}, {"iPhone", "iOS"}, {"iPad", "iOS"},
		{"Mac OS X", "macOS"}, {"Linux", "Linux"},
	} {
		if strings.Contains(ua, o.token) {
			system = o.name
			break
		}
	}
	if system == "" {
		return browser
	}
	return browser + " · " + system
}

func (a *App) mountAdminSessions(rt *Router) {
	um := []string{platform.UsersManage}
	rt.Handle("GET", "/admin/sessions", a.authed(um, a.listSessions))
	rt.Handle("DELETE", "/admin/sessions/{sid}", a.authed(um, a.endSessionByID))
	rt.Handle("DELETE", "/admin/sessions", a.authed(um, a.endUserSessionsOf))
}

func (a *App) listSessions(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	rows, err := a.Store.R.QueryContext(r.Context(), `SELECT s.rowid, u.id, u.login, u.full_name, u.active, org.id, org.name,
			d.user_agent, d.ip, s.created_at, d.last_seen, s.token_hash
		FROM user_sessions s
		JOIN session_devices d ON d.token_hash = s.token_hash
		JOIN users u ON u.id = s.user_id
		LEFT JOIN organisations org ON org.id = u.organisation_id
		WHERE s.expires_at > ?
		ORDER BY u.login COLLATE NOCASE, d.last_seen DESC`, a.now().Unix())
	if err != nil {
		return err
	}
	defer rows.Close()
	mine := hashToken(SessionFrom(r).Token)
	out := []adminSessionDTO{}
	for rows.Next() {
		var d adminSessionDTO
		var active int
		var orgID sql.NullInt64
		var orgName sql.NullString
		var ua, hash string
		var created, seen int64
		if err := rows.Scan(&d.ID, &d.UserID, &d.Login, &d.FullName, &active, &orgID, &orgName, &ua, &d.IP, &created, &seen, &hash); err != nil {
			return err
		}
		d.Active = active != 0
		if orgID.Valid {
			d.Organisation = &organisationRef{orgID.Int64, orgName.String}
		}
		d.Device = deviceLabel(ua)
		d.CreatedAt = servedTimeOf(time.Unix(created, 0))
		d.LastSeen = servedTimeOf(time.Unix(seen, 0))
		d.Current = hash == mine
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) endSessionByID(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	sid := pm.PathInt("sid")
	if err := pm.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	err := a.write(r.Context(), func(tx *sql.Tx) error {
		var hash, login string
		if err := tx.QueryRow(`SELECT s.token_hash, u.login FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.rowid = ?`, sid).Scan(&hash, &login); err != nil {
			if err == sql.ErrNoRows {
				return HTTPError{Status: 404, Detail: "Сеанс не знайдено."}
			}
			return err
		}
		if _, err := tx.Exec("DELETE FROM session_devices WHERE token_hash = ?", hash); err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM user_sessions WHERE token_hash = ?", hash); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "завершено сеанс користувача", login)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, messageDTO{"Сеанс завершено."})
	return nil
}

// endUserSessionsOf signs a user out everywhere (?user_id=).
func (a *App) endUserSessionsOf(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	uid := pm.OptInt("user_id")
	if err := pm.Err(); err != nil {
		return err
	}
	if uid == nil {
		return HTTPError{Status: 400, Detail: "Вкажіть user_id."}
	}
	ip := a.Trusted.ClientIP(r)
	err := a.write(r.Context(), func(tx *sql.Tx) error {
		var login string
		if err := tx.QueryRow("SELECT login FROM users WHERE id = ?", *uid).Scan(&login); err != nil {
			if err == sql.ErrNoRows {
				return HTTPError{Status: 404, Detail: "Користувача не знайдено."}
			}
			return err
		}
		if err := endUserSessions(tx, *uid); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "завершено сеанс користувача", login+" · усі пристрої")
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, messageDTO{"Користувача виведено з усіх пристроїв."})
	return nil
}
