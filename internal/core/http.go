package core

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// This file is the HTTP surface a feature module gets from the shell: who is calling (Caller), the platform
// services a handler may use (Services) and how a module declares its routes (Route). A module never sees the
// router, sessions or the permission check: it lists its routes and the shell wraps each one in authed/member.

// Org is an organisation (store, desk) as a module needs to know it.
type Org struct {
	ID       int64
	Name     string
	Archived bool
}

// Caller is the signed-in user as a module sees them. The shell builds it from its own principal.
type Caller struct {
	ID        int64
	Login     string
	FullName  string
	RoleLabel string // the audit log's role column
	Org       *Org   // nil for platform users
	Can       func(codes ...string) bool
}

// DisplayName is how an employee signs what they submit: the full name, else the login.
func (c *Caller) DisplayName() string {
	if n := strings.TrimSpace(c.FullName); n != "" {
		return n
	}
	return c.Login
}

// Services are the platform capabilities handed to a module's routes (Module.Routes).
type Services struct {
	// Read is the read-only database handle; for writes use Write.
	Read Querier
	// Write runs fn in the single writer transaction and commits; fn must use only the *sql.Tx it is given.
	Write func(ctx context.Context, fn func(tx *sql.Tx) error) error
	Now   func() time.Time
	// ClientIP is the caller's address as the platform trusts it (proxy headers only from trusted hosts).
	ClientIP func(r *http.Request) string
	// Audit writes an audit row of the caller's action inside tx.
	Audit func(tx *sql.Tx, ip string, c *Caller, action, detail string) error
	// Notify writes a notification per user inside tx.
	Notify func(tx *sql.Tx, userIDs []int64, kind, title, body, link string) error
	// NotifyHolders notifies everyone (except actor) holding one of codes; orgID > 0 limits it to one organisation.
	NotifyHolders func(ctx context.Context, tx *sql.Tx, actor, orgID int64, codes []string, kind, title, body, link string) error
	// Snapshot takes a database copy tagged tag before a destructive step (a no-op when backups are off).
	Snapshot func(tag string) error
	// Dashboard collects the blocks every module supplies to the management dashboard for a month (YYYY-MM).
	Dashboard func(ctx context.Context, period string, now time.Time) ([]DashboardBlock, error)
	// Organisation loads an organisation by id (nil when it does not exist).
	Organisation func(ctx context.Context, q Querier, id int64) (*Org, error)
}

// Handler serves one route. The error is turned into the response (HTTPError, FormError, ValidationError, ...).
type Handler func(w http.ResponseWriter, r *http.Request, c *Caller) error

// Route is one /api/v1 endpoint of a module. The shell registers it behind the permission check: the caller must
// hold one of Codes (none = any signed-in user), and with Member also belong to an organisation.
type Route struct {
	Method, Path string // Path like "/transport/orders/{oid}", relative to /api/v1
	Codes        []string
	Member       bool
	Handler      Handler
}

// JoinNames joins the non-empty parts of a notification text with " · ".
func JoinNames(parts ...string) string {
	var out []string
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, strings.TrimSpace(p))
		}
	}
	return strings.Join(out, " · ")
}

type paramsKey struct{}

// WithParams stores the matched {name} path parameters of a route in the request context (the router calls it).
func WithParams(ctx context.Context, params map[string]string) context.Context {
	return context.WithValue(ctx, paramsKey{}, params)
}

// Param returns a {name} path parameter of the matched route.
func Param(r *http.Request, name string) string {
	m, _ := r.Context().Value(paramsKey{}).(map[string]string)
	return m[name]
}

// WriteJSON writes a JSON body with compact separators and without HTML escaping (the API's wire format).
func WriteJSON(w http.ResponseWriter, status int, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(bytes.TrimRight(buf.Bytes(), "\n"))
}

// ServedTime is the API's UTC timestamp format (microseconds only when present).
func ServedTime(t time.Time) string {
	t = t.UTC()
	if t.Nanosecond() == 0 {
		return t.Format("2006-01-02T15:04:05Z")
	}
	return t.Format("2006-01-02T15:04:05.000000Z")
}
