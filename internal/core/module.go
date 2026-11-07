// Package core holds the contracts shared by the platform and the feature modules
package core

import (
	"context"
	"database/sql"
	"time"
)

// Querier is satisfied by *sql.DB, *sql.Tx and *sql.Conn.
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type Scope = string

const (
	ScopePlatform     Scope = "platform"
	ScopeOrganisation Scope = "organisation"
)

// Permission is a capability a role can grant.
type Permission struct {
	Code, Label, Scope, Description string
}

// OverviewStat is one figure a module shows on the administration overview.
type OverviewStat struct {
	Label, Value, Hint, Section string
}

// SeedTools are the platform services a module's demo seed may use, so a module never imports the platform.
type SeedTools struct {
	// CreateUser adds an active user (plain-text password) of an organisation with one role.
	CreateUser func(tx *sql.Tx, login, password string, orgID, roleID int64, now time.Time) error
}

// SeedFunc adds a module's demo data inside the first-run transaction.
type SeedFunc func(ctx context.Context, tx *sql.Tx, now time.Time, tools SeedTools) error

// Notifier is what the platform hands to a module's scheduled reminder. It is bound to the reminder's transaction.
type Notifier interface {
	// Recipients lists the active users holding any of the permission codes; orgID > 0 limits it to one organisation.
	Recipients(orgID int64, codes ...string) ([]int64, error)
	// Notify writes a notification per user; a non-empty dedupe key makes it idempotent per user.
	Notify(userIDs []int64, kind, title, body, link, dedupe string) error
}

// Module is everything the platform needs to know about a feature module.
type Module struct {
	Name, Title string
	// Routes returns the module's /api/v1 endpoints. The shell registers each behind the permission check its
	// Route declares, so a module never registers an unprotected route (see http.go).
	Routes        func(s Services) []Route
	Permissions   []Permission
	AuditActions  []string
	DefaultGrants map[string][]string // built-in role key -> permission codes
	// OrganisationUsage counts the records the module holds per organisation id. An organisation
	// with records is archived instead of deleted.
	OrganisationUsage func(ctx context.Context, q Querier) (map[int64]int, error)
	// Seed adds demo data (DEMO=1 on an empty database), inside the first-run transaction.
	Seed SeedFunc
	// DailyReminder runs once a day, after the configured reminder time, inside a write transaction. now is in
	// the configured zone. It must be idempotent (use dedupe keys): a restart may run it again the same day.
	DailyReminder func(ctx context.Context, tx *sql.Tx, now time.Time, n Notifier) error
	// Overview returns the figures the caller may see; can reports whether the caller holds any of
	// the given permission codes, period is the current YYYY-MM.
	Overview func(ctx context.Context, q Querier, can func(codes ...string) bool, period string) ([]OverviewStat, error)
	// Dashboard returns the module's blocks for the management dashboard (see DashboardFunc). Who may see the
	// dashboard is decided once, by the management module's own permission, not by the module.
	Dashboard DashboardFunc
}
