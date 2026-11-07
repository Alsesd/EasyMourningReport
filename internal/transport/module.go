// Package transport is the transport module: orders for the deceased (delivery and carriers), the fleet registry,
// desks' product requests, goods-delivery runs and the cargo that ties requested items to the orders and runs that
// carry them.
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
		{Code: Create, Label: "Замовлення транспорту й продукції", Scope: "organisation",
			Description: "Створювати замовлення транспорту й заявки на продукцію від імені свого підрозділу, бачити їхній статус, рейси з їхньою продукцією та список автомобілів."},
		{Code: ViewAll, Label: "Перегляд усіх замовлень транспорту й продукції", Scope: "platform",
			Description: "Лише перегляд: замовлення транспорту й заявки на продукцію всіх підрозділів, рейси, вантаж, автопарк та історія."},
		{Code: Manage, Label: "Обробка замовлень транспорту й продукції", Scope: "platform",
			Description: "Обробка замовлень і заявок на продукцію: бачити все всіх підрозділів, відповідати, змінювати статус, призначати авто, вантажити продукцію в замовлення та рейси, вести автопарк."},
	},
	AuditActions: []string{
		"створено замовлення транспорту", "змінено замовлення транспорту",
		"скасовано замовлення транспорту", "знято авто із замовлення транспорту", "змінено статус замовлення транспорту", "призначено носіїв замовлення транспорту",
		"змінено призначення замовлення транспорту", "змінено вантаж замовлення транспорту",
		"додано авто до автопарку", "змінено авто автопарку",
		"створено заявку на продукцію", "змінено заявку на продукцію", "скасовано заявку на продукцію", "відхилено заявку на продукцію",
		"створено рейс доставки продукції", "змінено рейс доставки продукції", "змінено статус рейсу доставки продукції",
	},
	OrganisationUsage: usage,
	Seed:              seed,
	DailyReminder:     remindMissingOrders,
	Startup:           BackfillCars,
	Routes:            routes,
	Overview:          overview,
	Dashboard:         Dashboard,
}

func usage(ctx context.Context, q core.Querier) (map[int64]int, error) {
	rows, err := q.QueryContext(ctx, `SELECT organisation_id, COUNT(*) FROM (
		SELECT organisation_id FROM transport_orders
		UNION ALL SELECT organisation_id FROM product_requests
		UNION ALL SELECT organisation_id FROM transport_run_stops) GROUP BY organisation_id`)
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
func seed(ctx context.Context, tx *sql.Tx, now time.Time, _ core.SeedTools) error {
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
			in.Delivery = &Delivery{CarNumber: "АА 1234 ВВ", Departure: "вул. Квітуча, 5", Time: "09:30", Destination: "Міський морг"}
			in.Carriers = &Carriers{CarNumber: "АА 1234 ВВ", Departure: "Міський морг", Count: 6, Time: "12:00", CemeteryNumber: "3", Stops: []string{"Дім жалоби", "Церква Св. Миколая"}}
		} else {
			in.Delivery = &Delivery{CarNumber: "ВС 5678 АА", Departure: "Міський морг", Time: "11:15", Destination: "Кладовище №2"}
		}
		if _, err := CreateOrder(ctx, tx, u.org, u.uid, u.login, in, now); err != nil {
			return err
		}
	}
	return seedFleet(ctx, tx, now)
}

// seedFleet adds demo cars (three standard plates and one nonstandard) and links the demo orders to them.
func seedFleet(ctx context.Context, tx *sql.Tx, now time.Time) error {
	cars := []struct {
		plate, label string
		nonstandard  bool
	}{
		{"АА1234ВВ", "Катафалк Mercedes", false},
		{"ВС5678АА", "Катафалк Ford", false},
		{"КА0101КК", "Вантажний Renault", false},
		{"ЗСУ1234", "Військовий (демо)", true},
	}
	for _, c := range cars {
		if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO transport_cars (plate, nonstandard, label, active, created_at) VALUES (?, ?, ?, 1, ?)",
			c.plate, b2i(c.nonstandard), c.label, now.Unix()); err != nil {
			return err
		}
	}
	for _, part := range []string{"delivery", "carriers"} {
		if _, err := tx.ExecContext(ctx, `UPDATE transport_orders SET `+part+`_car_id = (SELECT id FROM transport_cars WHERE plate = REPLACE(`+part+`_car, ' ', ''))
			WHERE `+part+`_car != '' AND `+part+`_car_id IS NULL`); err != nil {
			return err
		}
	}
	return nil
}
