// Package core holds the contracts shared by the platform and the feature modules
// (the Go form of backend/app/core/modules.py).
package core

import (
	"context"
	"database/sql"
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
}
