package web

import (
	"context"
	"crypto/ecdh"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"legkyi/internal/platform"
)

// Web Push: the browser registers a subscription (after the person allowed notifications), and a dispatcher sends
// every new notification to the recipient's browsers. Delivery never happens inside a write transaction: the
// notification row is written with the event, the dispatcher sends after the commit.

type pushKeyDTO struct {
	PublicKey string `json:"public_key"` // "" when push is not configured
}

func (a *App) mountPush(rt *Router) {
	rt.Handle("GET", "/push/key", a.authed(nil, a.pushKey))
	rt.Handle("POST", "/push/subscriptions", a.authed(nil, a.savePushSubscription))
	rt.Handle("DELETE", "/push/subscriptions", a.authed(nil, a.deletePushSubscription))
}

func (a *App) pushKey(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	out := pushKeyDTO{}
	if a.Push != nil {
		pub, err := platform.VAPIDPublicKey(a.Push.Key)
		if err != nil {
			return err
		}
		out.PublicKey = pub
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) pushAllow() func(*url.URL) error {
	if a.Push != nil && a.Push.Allow != nil {
		return a.Push.Allow
	}
	return platform.AllowedPushEndpoint
}

// savePushSubscription takes a PushSubscription.toJSON() body. The endpoint is checked now (https, a known push
// service), because the server will later POST to it.
func (a *App) savePushSubscription(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	if a.Push == nil {
		return HTTPError{Status: 404, Detail: "Push-сповіщення не налаштовано."}
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	endpoint := body.String("endpoint", 1, 2000)
	var sub platform.PushSubscription
	sub.Endpoint = endpoint
	if keys := body.Object("keys"); keys != nil {
		sub.P256dh = keys.String("p256dh", 1, 200)
		sub.Auth = keys.String("auth", 1, 100)
	} else {
		body.Fail("keys", "Field required", "missing")
	}
	if err := body.Err(); err != nil {
		return err
	}
	sub.P256dh, sub.Auth = strings.TrimRight(sub.P256dh, "="), strings.TrimRight(sub.Auth, "=") // stored unpadded
	bad := FormError{Message: "Некоректна підписка на сповіщення."}
	u, perr := url.Parse(endpoint)
	if perr != nil || a.pushAllow()(u) != nil {
		return bad
	}
	if pub, err := platform.DecodePushKey(sub.P256dh); err != nil {
		return bad
	} else if _, err := ecdh.P256().NewPublicKey(pub); err != nil {
		return bad
	}
	if auth, err := platform.DecodePushKey(sub.Auth); err != nil || len(auth) != 16 {
		return bad
	}
	if err := a.write(r.Context(), func(tx *sql.Tx) error { return platform.SavePushSubscription(tx, p.User.ID, sub, a.now()) }); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, messageDTO{"Сповіщення на цьому пристрої увімкнено."})
	return nil
}

func (a *App) deletePushSubscription(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	endpoint := Query(r).String("endpoint")
	if endpoint != "" {
		if err := a.write(r.Context(), func(tx *sql.Tx) error { return platform.DeletePushSubscription(tx, p.User.ID, endpoint) }); err != nil {
			return err
		}
	}
	writeJSON(w, http.StatusOK, messageDTO{"Сповіщення на цьому пристрої вимкнено."})
	return nil
}

// pushFreshness: only a notification created this recently is pushed. A row older than that (the column was just
// added, or the program was off for a while) is retired without sending, so phones are not flooded with history.
const pushFreshness = 10 * time.Minute

type pushPayload struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Link  string `json:"link"`
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

// pushPass sends what is waiting. Rows are claimed (pushed_at set) before sending: a crash loses a push rather
// than repeating it. Returns how many notifications it handled.
func (a *App) pushPass(ctx context.Context) (int, error) {
	now := a.now()
	if err := a.write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("UPDATE notifications SET pushed_at = 1 WHERE pushed_at = 0 AND created_at <= ?", now.Add(-pushFreshness).Unix())
		return err
	}); err != nil {
		return 0, err
	}
	rows, err := a.Store.R.QueryContext(ctx, "SELECT id, user_id, title, body, link FROM notifications WHERE pushed_at = 0 ORDER BY id LIMIT 50")
	if err != nil {
		return 0, err
	}
	type item struct {
		userID int64
		p      pushPayload
	}
	var items []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.p.ID, &it.userID, &it.p.Title, &it.p.Body, &it.p.Link); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(items) == 0 {
		return 0, err
	}
	if err := a.write(ctx, func(tx *sql.Tx) error {
		for _, it := range items {
			if _, err := tx.Exec("UPDATE notifications SET pushed_at = ? WHERE id = ?", now.Unix(), it.p.ID); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return 0, err
	}
	for _, it := range items {
		subs, err := platform.PushTargets(ctx, a.Store.R, it.userID)
		if err != nil {
			return len(items), err
		}
		it.p.Body = clip(it.p.Body, 300)
		payload, _ := json.Marshal(it.p)
		for _, sub := range subs {
			switch err := a.Push.Send(ctx, sub, payload); err {
			case nil:
			case platform.ErrSubscriptionGone:
				if werr := a.write(ctx, func(tx *sql.Tx) error { return platform.ForgetPushEndpoint(tx, sub.Endpoint) }); werr != nil {
					log.Printf("push: could not forget a gone subscription: %v", werr)
				}
			default:
				log.Printf("push to one browser of user %d failed: %v", it.userID, err)
			}
		}
	}
	return len(items), nil
}

// RunPushDispatcher polls for new notifications every few seconds until ctx ends. It sends nothing when push is
// not configured.
func RunPushDispatcher(ctx context.Context, d Deps) {
	if d.Push == nil {
		return
	}
	a := &App{Deps: d}
	t := time.NewTicker(3 * time.Second)
	defer t.Stop()
	for {
		pctx, cancel := context.WithTimeout(ctx, 90*time.Second)
		if _, err := a.pushPass(pctx); err != nil && ctx.Err() == nil {
			log.Printf("push dispatcher: %v", err)
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
