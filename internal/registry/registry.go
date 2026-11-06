// Package registry lists the installed modules, platform first.
// Only this package and cmd/server may import the module packages.
package registry

import (
	"context"
	"legkyi/internal/core"
	"legkyi/internal/platform"
	"legkyi/internal/reports"
	"legkyi/internal/transport"
	"sort"
)

type Registry struct{ Modules []core.Module }

func Installed() *Registry {
	return &Registry{Modules: []core.Module{platform.Module, reports.Module, transport.Module}}
}

func (r *Registry) Permission(code string) (core.Module, core.Permission, bool) {
	for _, m := range r.Modules {
		for _, p := range m.Permissions {
			if p.Code == code {
				return m, p, true
			}
		}
	}
	return core.Module{}, core.Permission{}, false
}

// Codes returns the permission codes of a scope ("" = all).
func (r *Registry) Codes(scope string) map[string]bool {
	out := map[string]bool{}
	for _, m := range r.Modules {
		for _, p := range m.Permissions {
			if scope == "" || p.Scope == scope {
				out[p.Code] = true
			}
		}
	}
	return out
}

func (r *Registry) AuditActions() []string {
	var seen []string
	have := map[string]bool{}
	for _, m := range r.Modules {
		for _, a := range m.AuditActions {
			if !have[a] {
				have[a] = true
				seen = append(seen, a)
			}
		}
	}
	return seen
}

func (r *Registry) DefaultGrants() map[string][]string {
	out := map[string][]string{}
	for _, m := range r.Modules {
		for k, v := range m.DefaultGrants {
			out[k] = append(out[k], v...)
		}
	}
	return out
}

func (r *Registry) Names() []string {
	n := make([]string, len(r.Modules))
	for i, m := range r.Modules {
		n[i] = m.Name
	}
	return n
}

// UsageEntry is one module's record count for an organisation.
type UsageEntry struct {
	Module string
	Count  int
}

// OrganisationUsage: organisation id -> per-module counts (module order), non-zero only.
func (r *Registry) OrganisationUsage(ctx context.Context, q core.Querier) (map[int64][]UsageEntry, error) {
	out := map[int64][]UsageEntry{}
	for _, m := range r.Modules {
		if m.OrganisationUsage == nil {
			continue
		}
		counts, err := m.OrganisationUsage(ctx, q)
		if err != nil {
			return nil, err
		}
		ids := make([]int64, 0, len(counts))
		for id := range counts {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		for _, id := range ids {
			if counts[id] != 0 {
				out[id] = append(out[id], UsageEntry{m.Name, counts[id]})
			}
		}
	}
	return out, nil
}

// Seeds returns the demo-data hooks of the installed modules.
func (r *Registry) Seeds() []core.SeedFunc {
	var out []core.SeedFunc
	for _, m := range r.Modules {
		if m.Seed != nil {
			out = append(out, m.Seed)
		}
	}
	return out
}
