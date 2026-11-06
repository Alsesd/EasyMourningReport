package reports

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"legkyi/internal/platform"
)

// SeedDemo is the DEMO=1 data: three products and two stores with logins (password = login).
func SeedDemo(ctx context.Context, tx *sql.Tx, now time.Time) error {
	products := []struct {
		name  string
		cents int64
	}{{"Яблука, кг", 250}, {"Хліб", 120}, {"Молоко, 1 л", 95}}
	for _, p := range products {
		res, err := tx.ExecContext(ctx, "INSERT INTO products (name, price_cents, active, archived) VALUES (?, ?, 1, 0)", p.name, p.cents)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		if _, err := tx.ExecContext(ctx, "INSERT INTO product_prices (product_id, period, price_cents) VALUES (?, ?, ?)", id, BasePeriod, p.cents); err != nil {
			return err
		}
	}
	var role int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM roles WHERE "key" = 'store'`).Scan(&role); err != nil {
		return err
	}
	for n := 1; n <= 2; n++ {
		res, err := tx.ExecContext(ctx, "INSERT INTO organisations (name, archived) VALUES (?, 0)", fmt.Sprintf("Магазин %d", n))
		if err != nil {
			return err
		}
		org, _ := res.LastInsertId()
		login := fmt.Sprintf("store%d", n)
		hash, err := platform.HashPassword(login, nil)
		if err != nil {
			return err
		}
		if _, err := platform.CreateUser(tx, login, hash, &org, now, role); err != nil {
			return err
		}
	}
	return nil
}
