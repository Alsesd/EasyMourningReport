package web

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"time"

	"legkyi/internal/platform"
	"legkyi/internal/transport"
)

type notificationDTO struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Link      string `json:"link"`
	CreatedAt string `json:"created_at"`
	Read      bool   `json:"read"`
}

type notificationsDTO struct {
	Unread int               `json:"unread"`
	Items  []notificationDTO `json:"items"`
}

// mountNotifications: every signed-in user has a bell; a user only ever reads and marks their own rows.
func (a *App) mountNotifications(rt *Router) {
	rt.Handle("GET", "/notifications", a.authed(nil, a.listNotifications))
	rt.Handle("POST", "/notifications/read-all", a.authed(nil, a.readAllNotifications))
	rt.Handle("POST", "/notifications/{nid}/read", a.authed(nil, a.readNotification))
}

func (a *App) listNotifications(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	limit := int64(30)
	if v := pm.OptInt("limit"); v != nil {
		limit = *v
	}
	if err := pm.Err(); err != nil {
		return err
	}
	list, unread, err := platform.ListNotifications(r.Context(), a.Store.R, p.User.ID, int(max(1, min(limit, 100))))
	if err != nil {
		return err
	}
	out := notificationsDTO{Unread: unread, Items: make([]notificationDTO, 0, len(list))}
	for _, n := range list {
		out.Items = append(out.Items, notificationDTO{n.ID, n.Kind, n.Title, n.Body, n.Link, servedTimeOf(time.Unix(n.CreatedAt, 0)), n.Read})
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) markNotifications(w http.ResponseWriter, r *http.Request, p *platform.Principal, id int64) error {
	if err := a.write(r.Context(), func(tx *sql.Tx) error { return platform.MarkRead(tx, p.User.ID, id, a.now()) }); err != nil {
		return err
	}
	return a.listNotifications(w, r, p)
}

func (a *App) readAllNotifications(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	return a.markNotifications(w, r, p, 0)
}

func (a *App) readNotification(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	id := pm.PathInt("nid")
	if err := pm.Err(); err != nil {
		return err
	}
	return a.markNotifications(w, r, p, id)
}

// notify writes a notification for each user inside the transaction of the event that caused it.
func (a *App) notify(tx *sql.Tx, ids []int64, kind, title, body, link string) error {
	return platform.Notify(tx, a.now(), ids, kind, title, body, link, "")
}

// notifyHolders notifies everyone (except the actor, who knows what they just did) who holds one of the
// permission codes; orgID > 0 limits it to one organisation's users.
func (a *App) notifyHolders(ctx context.Context, tx *sql.Tx, actor, orgID int64, codes []string, kind, title, body, link string) error {
	ids, err := platform.Recipients(ctx, tx, a.Registry.Codes, orgID, codes...)
	if err != nil {
		return err
	}
	out := ids[:0]
	for _, id := range ids {
		if id != actor {
			out = append(out, id)
		}
	}
	return a.notify(tx, out, kind, title, body, link)
}

// --- scheduled jobs ------------------------------------------------------------------------------------------

// SchedulerConfig: ReminderAt is "HH:MM" in Loc ("" turns the reminder off).
type SchedulerConfig struct {
	ReminderAt string
	Loc        *time.Location
}

// RunScheduler runs the minute loop of the background jobs until ctx ends: the evening reminder to the desks that
// have no transport order for tomorrow yet, and the pruning of old notifications. Both are idempotent, so a
// restart after the time of day neither repeats nor skips them.
func RunScheduler(ctx context.Context, d Deps, cfg SchedulerConfig) {
	a := &App{Deps: d}
	if cfg.Loc == nil {
		cfg.Loc = time.Local
	}
	at, hasAt := parseClock(cfg.ReminderAt)
	var remindedOn, prunedOn string
	tick := func() {
		now := a.now().In(cfg.Loc)
		day := now.Format("2006-01-02")
		if prunedOn != day {
			if err := a.write(ctx, func(tx *sql.Tx) error {
				return platform.PruneNotifications(tx, now, 30*24*time.Hour, 180*24*time.Hour)
			}); err != nil {
				log.Printf("pruning notifications failed: %v", err)
			} else {
				prunedOn = day
			}
		}
		if hasAt && remindedOn != day && now.Hour()*60+now.Minute() >= at {
			if err := a.remindDesksWithoutTomorrow(ctx, now); err != nil {
				log.Printf("transport reminder failed: %v", err)
			} else {
				remindedOn = day
			}
		}
	}
	tick()
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			tick()
		}
	}
}

// parseClock reads "HH:MM" as minutes since midnight.
func parseClock(s string) (int, bool) {
	if !transport.ValidTime(s) {
		return 0, false
	}
	return int(s[0]-'0')*600 + int(s[1]-'0')*60 + int(s[3]-'0')*10 + int(s[4]-'0'), true
}

// remindDesksWithoutTomorrow tells the staff of every organisation that may order transport and has no order for
// tomorrow (one that still holds or has done its car; cancelled, rejected and bumped ones do not count) that the order
// is missing. The dedupe key keeps it to one reminder per person and day.
func (a *App) remindDesksWithoutTomorrow(ctx context.Context, now time.Time) error {
	tomorrow := now.AddDate(0, 0, 1)
	day := tomorrow.Format("2006-01-02")
	return a.write(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT o.id, o.name FROM organisations o WHERE o.archived = 0 AND NOT EXISTS (
			SELECT 1 FROM transport_orders t WHERE t.organisation_id = o.id AND t.service_date = ? AND t.status IN (?, ?, ?, ?))
			ORDER BY o.id`, day, transport.Submitted, transport.Accepted, transport.InProgress, transport.Done)
		if err != nil {
			return err
		}
		type org struct {
			id   int64
			name string
		}
		var orgs []org
		for rows.Next() {
			var o org
			if err := rows.Scan(&o.id, &o.name); err != nil {
				rows.Close()
				return err
			}
			orgs = append(orgs, o)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, o := range orgs {
			ids, err := platform.Recipients(ctx, tx, a.Registry.Codes, o.id, transport.Create)
			if err != nil {
				return err
			}
			title := "Замовлення транспорту на завтра ще не зроблено"
			body := "Уже " + now.Format("15:04") + ", а замовлення на " + tomorrow.Format("02.01.2006") + " для «" + o.name + "» немає."
			if err := platform.Notify(tx, a.now(), ids, "transport.reminder", title, body, "/admin/transport", "transport-reminder:"+day); err != nil {
				return err
			}
		}
		return nil
	})
}
