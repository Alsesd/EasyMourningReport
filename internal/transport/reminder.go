package transport

import (
	"context"
	"database/sql"
	"time"

	"legkyi/internal/core"
)

// remindMissingOrders is the module's daily reminder: every organisation that may order transport and has no order
// for tomorrow that holds or has done a car (cancelled, rejected and bumped ones do not count) is told that the
// order is missing, once per person and day (the dedupe key). It talks to the platform only through core.Notifier.
func remindMissingOrders(ctx context.Context, tx *sql.Tx, now time.Time, n core.Notifier) error {
	tomorrow := now.AddDate(0, 0, 1)
	day := tomorrow.Format("2006-01-02")
	rows, err := tx.QueryContext(ctx, `SELECT o.id, o.name FROM organisations o WHERE o.archived = 0 AND NOT EXISTS (
		SELECT 1 FROM transport_orders t WHERE t.organisation_id = o.id AND t.service_date = ? AND t.status IN (?, ?, ?, ?))
		ORDER BY o.id`, day, Submitted, Accepted, InProgress, Done)
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
		ids, err := n.Recipients(o.id, Create)
		if err != nil {
			return err
		}
		title := "Замовлення транспорту на завтра ще не зроблено"
		body := "Уже " + now.Format("15:04") + ", а замовлення на " + tomorrow.Format("02.01.2006") + " для «" + o.name + "» немає."
		if err := n.Notify(ids, "transport.reminder", title, body, "/admin/transport", "transport-reminder:"+day); err != nil {
			return err
		}
	}
	return nil
}
