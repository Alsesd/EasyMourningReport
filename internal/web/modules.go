package web

import (
	"context"
	"database/sql"
	"net/http"

	"legkyi/internal/core"
	"legkyi/internal/platform"
)

// This is the only place where the shell meets a feature module's HTTP surface: it hands the module the platform
// services it may use and registers every route the module lists behind the permission check the route declares.
// A module cannot register an unprotected route, and the shell never imports a module.

func (a *App) services() core.Services {
	return core.Services{
		Read:     a.Store.R,
		Write:    a.write,
		Now:      a.now,
		ClientIP: func(r *http.Request) string { return a.Trusted.ClientIP(r) },
		Audit: func(tx *sql.Tx, ip string, c *core.Caller, action, detail string) error {
			return platform.Audit(tx, a.now(), ip, c.Login, c.RoleLabel, action, detail)
		},
		Notify:        a.notify,
		NotifyHolders: a.notifyHolders,
		Snapshot: func(tag string) error {
			if a.Backups == nil {
				return nil
			}
			_, err := a.Backups.Run(tag)
			return err
		},
		Organisation: func(ctx context.Context, q core.Querier, id int64) (*core.Org, error) {
			o, err := platform.LoadOrganisation(ctx, q, id)
			if err != nil || o == nil {
				return nil, err
			}
			return &core.Org{ID: o.ID, Name: o.Name, Archived: o.Archived}, nil
		},
	}
}

// callerOf is the module's view of the signed-in user.
func callerOf(p *platform.Principal) *core.Caller {
	c := &core.Caller{ID: p.User.ID, Login: p.User.Login, FullName: p.User.FullName, RoleLabel: p.User.RoleLabel(), Can: p.Can}
	if o := p.User.Org; o != nil {
		c.Org = &core.Org{ID: o.ID, Name: o.Name, Archived: o.Archived}
	}
	return c
}

// mountModules registers the routes of every installed module, in registry order.
func (a *App) mountModules(rt *Router) {
	s := a.services()
	for _, m := range a.Registry.Modules {
		if m.Routes == nil {
			continue
		}
		for _, ro := range m.Routes(s) {
			h := ro.Handler
			wrap := func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
				return h(w, r, callerOf(p))
			}
			if ro.Member {
				rt.Handle(ro.Method, ro.Path, a.member(ro.Codes, wrap))
			} else {
				rt.Handle(ro.Method, ro.Path, a.authed(ro.Codes, wrap))
			}
		}
	}
}
