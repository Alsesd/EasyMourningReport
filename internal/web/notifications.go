package web

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"regexp"
	"time"

	"legkyi/internal/platform"
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

// SchedulerConfig: ReminderAt is "HH:MM" in Loc ("" turns the daily reminders off).
type SchedulerConfig struct {
	ReminderAt string
	Loc        *time.Location
}

// RunScheduler runs the minute loop of the background jobs until ctx ends: the modules' daily reminders (e.g. the
// desks that have no transport order for tomorrow yet) and the pruning of old notifications. Both are idempotent, so a
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
			if err := a.runDailyReminders(ctx, now); err != nil {
				log.Printf("daily reminders failed, will retry: %v", err)
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

var clockRE = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// parseClock reads "HH:MM" as minutes since midnight.
func parseClock(s string) (int, bool) {
	if !clockRE.MatchString(s) {
		return 0, false
	}
	return int(s[0]-'0')*600 + int(s[1]-'0')*60 + int(s[3]-'0')*10 + int(s[4]-'0'), true
}

// txNotifier is the core.Notifier of one write transaction.
type txNotifier struct {
	a   *App
	ctx context.Context
	tx  *sql.Tx
}

func (n txNotifier) Recipients(orgID int64, codes ...string) ([]int64, error) {
	return platform.Recipients(n.ctx, n.tx, n.a.Registry.Codes, orgID, codes...)
}

func (n txNotifier) Notify(ids []int64, kind, title, body, link, dedupe string) error {
	return platform.Notify(n.tx, n.a.now(), ids, kind, title, body, link, dedupe)
}

// runDailyReminders gives every installed module's DailyReminder its own transaction (one module failing does not
// stop the others) and returns the first error so the scheduler tries again on the next tick.
func (a *App) runDailyReminders(ctx context.Context, now time.Time) error {
	var first error
	for _, m := range a.Registry.Modules {
		if m.DailyReminder == nil {
			continue
		}
		if err := a.write(ctx, func(tx *sql.Tx) error { return m.DailyReminder(ctx, tx, now, txNotifier{a, ctx, tx}) }); err != nil {
			log.Printf("daily reminder of module %s failed: %v", m.Name, err)
			if first == nil {
				first = err
			}
		}
	}
	return first
}
