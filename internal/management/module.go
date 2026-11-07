// Package management is the management dashboard: business figures for the people who run the business. It holds
// no data of its own. The blocks come from the other modules through core (Services.Dashboard), so the slices stay
// apart, and one permission, view-only, decides who sees them.
package management

import (
	"net/http"
	"regexp"
	"time"

	"legkyi/internal/core"
)

// View lets a user open the management dashboard. It reads figures only: it grants no right to change reports,
// orders or anything else, which is why a manager's role should hold this code and nothing that edits.
const View = "management.dashboard.view"

var periodRE = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

var Module = core.Module{
	Name:  "management",
	Title: "Керівництво",
	Permissions: []core.Permission{
		{Code: View, Label: "Показники для керівництва", Scope: "platform",
			Description: "Дивитися бізнес-показники: виручку, звіти підрозділів, замовлення транспорту. Лише перегляд: змінювати дані це право не дозволяє."},
	},
	Routes: routes,
}

type dashboardDTO struct {
	Period string                `json:"period"`
	Blocks []core.DashboardBlock `json:"blocks"`
}

func routes(s core.Services) []core.Route {
	return []core.Route{
		{Method: "GET", Path: "/dashboard", Codes: []string{View}, Handler: func(w http.ResponseWriter, r *http.Request, c *core.Caller) error {
			pm := core.Query(r)
			period := pm.String("period")
			if err := pm.Err(); err != nil {
				return err
			}
			now := s.Now().In(time.Local)
			if period == "" {
				period = now.Format("2006-01")
			}
			if !periodRE.MatchString(period) {
				return core.HTTPError{Status: 400, Detail: "Місяць має мати вигляд 2026-10"}
			}
			blocks, err := s.Dashboard(r.Context(), period, now)
			if err != nil {
				return err
			}
			if blocks == nil {
				blocks = []core.DashboardBlock{}
			}
			core.WriteJSON(w, http.StatusOK, dashboardDTO{Period: period, Blocks: blocks})
			return nil
		}},
	}
}
