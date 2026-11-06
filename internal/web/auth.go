package web

import (
	"database/sql"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"legkyi/internal/platform"
)

func normLogin(raw string) string { return strings.ToLower(strings.TrimSpace(raw)) }

// currentPeriod is the server's local calendar month, YYYY-MM (tests pin it via Deps.Now).
func (a *App) currentPeriod() string { return a.now().In(time.Local).Format("2006-01") }

type organisationRef struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// sessionDTO follows the Pydantic SessionDTO field order.
type sessionDTO struct {
	UserID       int64            `json:"user_id"`
	Login        string           `json:"login"`
	FullName     string           `json:"full_name"`
	Organisation *organisationRef `json:"organisation"`
	Roles        []string         `json:"roles"`
	Permissions  []string         `json:"permissions"`
	Modules      []string         `json:"modules"`
	Period       string           `json:"period"`
}

type messageDTO struct {
	Message string `json:"message"`
}

func (a *App) sessionDTO(p *platform.Principal) sessionDTO {
	u := p.User
	d := sessionDTO{
		UserID: u.ID, Login: u.Login, FullName: u.FullName,
		Roles: []string{}, Permissions: []string{}, Modules: a.Registry.Names(), Period: a.currentPeriod(),
	}
	if u.Org != nil {
		d.Organisation = &organisationRef{u.Org.ID, u.Org.Name}
	}
	for _, r := range u.Roles {
		d.Roles = append(d.Roles, r.Name)
	}
	sort.Strings(d.Roles)
	for c := range p.Permissions {
		d.Permissions = append(d.Permissions, c)
	}
	sort.Strings(d.Permissions)
	return d
}

func (a *App) mountPlatform(rt *Router) {
	rt.Handle("GET", "/session", a.authed(nil, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		writeJSON(w, http.StatusOK, a.sessionDTO(p))
		return nil
	}))
	rt.Handle("POST", "/auth/login", a.handle(a.login))
	rt.Handle("POST", "/auth/logout", a.handle(a.logout))
	rt.Handle("PUT", "/me/password", a.authed(nil, a.changeOwnPassword))
}

// dummyPasswordHash is a valid hash nobody knows the password of, computed once.
var dummyPasswordHash = sync.OnceValue(func() string {
	h, _ := platform.HashPassword("no-such-user-placeholder", []byte("legkyi-timing-pad"))
	return h
})

func (a *App) login(w http.ResponseWriter, r *http.Request) error {
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	loginRaw := body.String("login", 1, 100)
	password := body.String("password", 1, 256) // sign-in accepts any existing password
	if err := body.Err(); err != nil {
		return err
	}
	ctx := r.Context()
	key, ip := normLogin(loginRaw), a.Trusted.ClientIP(r)
	if wait := a.Limiter.RetryAfter(ip, key); wait > 0 {
		return HTTPError{Status: 429, Detail: "Забагато невдалих спроб. Спробуйте пізніше.",
			Headers: map[string]string{"Retry-After": strconv.Itoa(wait), "Cache-Control": "no-store"}}
	}
	user, err := platform.LoadUserByLogin(ctx, a.Store.R, key)
	if err != nil {
		return err
	}
	if user == nil {
		// Spend the same time as a real check so the response time does not reveal which logins exist.
		platform.CheckPassword(password, dummyPasswordHash())
	}
	if user == nil || !platform.CheckPassword(password, user.PasswordHash) {
		a.Limiter.RecordFailure(ip, key)
		name := key
		if name == "" {
			name = "?"
		}
		if err := a.audit(r, ip, name, "", "невдалий вхід", ""); err != nil {
			return err
		}
		return HTTPError{Status: 401, Detail: "Неправильний логін або пароль"}
	}
	if !user.CanSignIn() {
		a.Limiter.RecordFailure(ip, key)
		reason := "обліковий запис вимкнено"
		if user.Active {
			reason = "підрозділ в архіві"
		}
		if err := a.audit(r, ip, user.Login, user.RoleLabel(), "невдалий вхід", reason); err != nil {
			return err
		}
		return HTTPError{Status: 403, Detail: "Цей обліковий запис вимкнено. Зверніться до адміністратора."}
	}
	a.Limiter.Clear(ip, key)
	if err := a.audit(r, ip, user.Login, user.RoleLabel(), "вхід", ""); err != nil {
		return err
	}
	var token, device string
	if err := a.write(ctx, func(tx *sql.Tx) error {
		var err error
		if platform.NeedsRehash(user.PasswordHash) { // upgrade an old hash now that the password is known
			upgraded, err := platform.HashPassword(password, nil)
			if err != nil {
				return err
			}
			if _, err := tx.Exec("UPDATE users SET password_hash = ? WHERE id = ?", upgraded, user.ID); err != nil {
				return err
			}
		}
		token, device, err = startSession(tx, user.ID, a.now(), a.metaOf(r))
		return err
	}); err != nil {
		return err
	}
	SessionFrom(r).Start(user.ID, token, device)
	p, err := platform.PrincipalFor(ctx, a.Store.R, user, a.Registry.Codes)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, a.sessionDTO(p))
	return nil
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) error {
	s := SessionFrom(r)
	if s.UID != 0 {
		if user, err := platform.LoadUserByID(r.Context(), a.Store.R, s.UID); err != nil {
			return err
		} else if user != nil {
			if err := a.audit(r, a.Trusted.ClientIP(r), user.Login, user.RoleLabel(), "вихід", ""); err != nil {
				return err
			}
		}
	}
	if s.Token != "" {
		if err := a.write(r.Context(), func(tx *sql.Tx) error { return endSession(tx, s.Token) }); err != nil {
			return err
		}
	}
	s.Clear()
	writeJSON(w, http.StatusOK, messageDTO{"Ви вийшли із системи."})
	return nil
}

func (a *App) changeOwnPassword(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
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
	var token, device string
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hash, p.User.ID); err != nil {
			return err
		}
		// Every device is signed out; this one gets a fresh session.
		if err := endUserSessions(tx, p.User.ID); err != nil {
			return err
		}
		var err error
		if token, device, err = startSession(tx, p.User.ID, a.now(), a.metaOf(r)); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено власний пароль", "")
	})
	if err != nil {
		return err
	}
	SessionFrom(r).Start(p.User.ID, token, device)
	writeJSON(w, http.StatusOK, messageDTO{"Ваш пароль змінено."})
	return nil
}

// audit writes one audit row in its own committed transaction (used by sign-in/out, where
// failed logins must be recorded even though the request itself fails).
func (a *App) audit(r *http.Request, ip, login, role, action, detail string) error {
	return a.write(r.Context(), func(tx *sql.Tx) error {
		return platform.Audit(tx, a.now(), ip, login, role, action, detail)
	})
}
