package web

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"legkyi/internal/platform"
	"legkyi/internal/registry"
	"legkyi/internal/store"
)

// Deps is everything the HTTP layer needs. New builds the exact stack production serves,
// and the contract-replay tests build it the same way.
type Deps struct {
	Store        *store.Store
	Assets       fs.FS
	Registry     *registry.Registry
	Secret       []byte
	CookieSecure bool
	Trusted      *TrustedHosts
	Now          func() time.Time
	Limiter      *LoginLimiter
}

// App holds the dependencies handlers share.
type App struct {
	Deps
}

func (a *App) now() time.Time {
	if a.Now != nil {
		return a.Now()
	}
	return time.Now()
}

// New composes the middleware chain: session (outermost) -> same-origin guard -> routes.
func New(d Deps) http.Handler {
	if d.Limiter == nil {
		d.Limiter = NewLoginLimiter()
	}
	if d.Trusted == nil {
		d.Trusted = ParseTrustedHosts("127.0.0.1")
	}
	app := &App{Deps: d}
	rt := &Router{}
	app.mountPlatform(rt)
	srv := &Server{DB: d.Store, Assets: d.Assets, API: rt}
	return sessionMiddleware(Signer{Secret: d.Secret, Now: d.Now}, d.CookieSecure, sameOriginGuard(srv))
}

// LoadSecret: SECRET_KEY wins; otherwise <data>/secret.key, created (0600, never overwritten) when absent.
func LoadSecret(getenv func(string) string, dataDir string) ([]byte, error) {
	if v := getenv("SECRET_KEY"); v != "" {
		return []byte(v), nil
	}
	path := filepath.Join(dataDir, "secret.key")
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err == nil {
		_, werr := f.WriteString(hex.EncodeToString(b))
		cerr := f.Close()
		if werr != nil {
			return nil, werr
		}
		if cerr != nil {
			return nil, cerr
		}
	} else if !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return []byte(strings.TrimSpace(string(data))), nil
}

// principal returns the signed-in user or a 401. Disabled accounts and archived
// organisations are signed out.
func (a *App) principal(r *http.Request) (*platform.Principal, error) {
	uid := SessionFrom(r).UID
	if uid == 0 {
		return nil, HTTPError{Status: 401, Detail: "Увійдіть у систему."}
	}
	u, err := platform.LoadUserByID(r.Context(), a.Store.R, uid)
	if err != nil {
		return nil, err
	}
	if u == nil || !u.CanSignIn() {
		return nil, HTTPError{Status: 401, Detail: "Увійдіть у систему."}
	}
	return platform.PrincipalFor(r.Context(), a.Store.R, u, a.Registry.Codes)
}

type authedHandler func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error

// authed requires a signed-in user holding at least one of codes (none = any signed-in user).
func (a *App) authed(codes []string, h authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, err := a.principal(r)
		if err == nil && len(codes) > 0 && !p.Can(codes...) {
			err = HTTPError{Status: 403, Detail: "Недостатньо прав для цієї дії."}
		}
		if err == nil {
			err = h(w, r, p)
		}
		a.done(w, err)
	}
}

// member is like authed but the caller must also belong to an organisation.
func (a *App) member(codes []string, h authedHandler) http.HandlerFunc {
	return a.authed(codes, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		if p.User.Org == nil {
			return HTTPError{Status: 403, Detail: "Лише для користувачів організацій."}
		}
		return h(w, r, p)
	})
}

// handle adapts an error-returning handler.
func (a *App) handle(h func(w http.ResponseWriter, r *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { a.done(w, h(w, r)) }
}

func (a *App) done(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}
	switch err.(type) {
	case validationError, FormError, HTTPError:
		fail(w, err)
	default:
		log.Printf("internal error: %v", err)
		fail(w, err)
	}
}

// write runs fn inside one immediate transaction on the single writer connection and commits.
// fn must use only the *sql.Tx (never a.Store.W or Begin again: that would deadlock).
func (a *App) write(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := a.Store.W.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}
