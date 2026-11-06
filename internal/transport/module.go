// Package transport is the scaffolded transport-orders module (status stub only).
package transport

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"legkyi/internal/core"
)

const (
	Create  = "transport.orders.create"
	ViewAll = "transport.orders.view_all"
	Manage  = "transport.orders.manage"
)

var Module = core.Module{
	Name:  "transport",
	Title: "Транспорт",
	Permissions: []core.Permission{
		{Code: Create, Label: "Замовлення транспорту", Scope: "organisation",
			Description: "Створювати замовлення транспорту від імені своєї організації й бачити їхній статус."},
		{Code: ViewAll, Label: "Перегляд усіх замовлень транспорту", Scope: "platform",
			Description: "Бачити замовлення транспорту всіх організацій."},
		{Code: Manage, Label: "Обробка замовлень транспорту", Scope: "platform",
			Description: "Приймати замовлення й змінювати їхній статус."},
	},
	AuditActions: []string{
		"створено замовлення транспорту", "змінено замовлення транспорту",
		"скасовано замовлення транспорту", "змінено статус замовлення транспорту",
	},
	OrganisationUsage: usage,
	Seed:              seed,
	Overview:          overview,
}

func usage(ctx context.Context, q core.Querier) (map[int64]int, error) {
	rows, err := q.QueryContext(ctx, "SELECT organisation_id, COUNT(id) FROM transport_orders GROUP BY organisation_id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int{}
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// overview shows dispatchers what waits for an answer.
func overview(ctx context.Context, q core.Querier, can func(codes ...string) bool, period string) ([]core.OverviewStat, error) {
	if !can(Manage, ViewAll) {
		return nil, nil
	}
	var waiting, today int
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM transport_orders WHERE status = ?", Submitted).Scan(&waiting); err != nil {
		return nil, err
	}
	day := time.Now().In(time.Local).Format("2006-01-02")
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM transport_orders WHERE service_date = ? AND status NOT IN (?, ?)", day, Cancelled, Rejected).Scan(&today); err != nil {
		return nil, err
	}
	return []core.OverviewStat{{Label: "Замовлень транспорту без відповіді", Value: fmt.Sprint(waiting),
		Hint: fmt.Sprintf("на сьогодні: %d", today)}}, nil
}

// seed adds two demo orders for the demo shops and lets the demo shop role place orders.
func seed(ctx context.Context, tx *sql.Tx, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO role_permissions (role_id, permission)
		SELECT id, ? FROM roles WHERE "key" = 'store'`, Create); err != nil {
		return err
	}
	day := now.In(time.Local).Format("2006-01-02")
	rows, err := tx.QueryContext(ctx, "SELECT u.id, u.login, u.organisation_id FROM users u WHERE u.organisation_id IS NOT NULL ORDER BY u.id LIMIT 2")
	if err != nil {
		return err
	}
	type demo struct {
		uid, org int64
		login    string
	}
	var users []demo
	for rows.Next() {
		var d demo
		if err := rows.Scan(&d.uid, &d.login, &d.org); err != nil {
			rows.Close()
			return err
		}
		users = append(users, d)
	}
	rows.Close()
	for i, u := range users {
		in := Input{ServiceDate: day, Deceased: fmt.Sprintf("Іваненко І. І. (демо %d)", i+1)}
		if i == 0 {
			in.Delivery = &Delivery{CarNumber: "АА 1234 ВВ", Time: "09:30", Destination: "Міський морг"}
			in.Carriers = &Carriers{Count: 6, Time: "12:00", From: "вул. Квітуча, 5", CemeteryNumber: "3", Stops: []string{"Церква Св. Миколая"}}
		} else {
			in.Delivery = &Delivery{CarNumber: "ВС 5678 АА", Time: "11:15", Destination: "Кладовище №2"}
		}
		if _, err := CreateOrder(ctx, tx, u.org, u.uid, u.login, in, now); err != nil {
			return err
		}
	}
	return nil
}
