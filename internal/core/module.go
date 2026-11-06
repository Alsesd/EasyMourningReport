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

// Module is everything the platform needs to know about a feature module. Routes are
// registered separately (web.Mount), so this stays free of HTTP types.
type Module struct {
	Name, Title   string
	Permissions   []Permission
	AuditActions  []string
	DefaultGrants map[string][]string // built-in role key -> permission codes
	// OrganisationUsage counts the records the module holds per organisation id. An organisation
	// with records is archived instead of deleted.
	OrganisationUsage func(ctx context.Context, q Querier) (map[int64]int, error)
	// Seed adds demo data (DEMO=1 on an empty database), inside the first-run transaction.
	Seed func(ctx context.Context, tx *sql.Tx, now time.Time) error
	// Overview returns the figures the caller may see; can reports whether the caller holds any of
	// the given permission codes, period is the current YYYY-MM.
	Overview func(ctx context.Context, q Querier, can func(codes ...string) bool, period string) ([]OverviewStat, error)
}
