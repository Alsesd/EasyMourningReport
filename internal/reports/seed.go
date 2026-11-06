package reports

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"legkyi/internal/core"
)

// SeedDemo is the DEMO=1 data: three products and two stores with logins (password = login).
func SeedDemo(ctx context.Context, tx *sql.Tx, now time.Time, tools core.SeedTools) error {
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
	// A new installation has no division roles; the demo brings one with the permission to fill in reports.
	var role int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM roles WHERE "key" = 'store'`).Scan(&role)
	if err == sql.ErrNoRows {
		res, err := tx.ExecContext(ctx, `INSERT INTO roles ("key", name, scope) VALUES ('store', 'Підрозділ (демо)', 'organisation')`)
		if err != nil {
			return err
		}
		role, _ = res.LastInsertId()
		if _, err := tx.ExecContext(ctx, "INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)", role, Submit); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	for n := 1; n <= 2; n++ {
		res, err := tx.ExecContext(ctx, "INSERT INTO organisations (name, archived) VALUES (?, 0)", fmt.Sprintf("Підрозділ %d", n))
		if err != nil {
			return err
		}
		org, _ := res.LastInsertId()
		login := fmt.Sprintf("store%d", n)
		// e.g. Store1-demo
		if err := tools.CreateUser(tx, login, strings.ToUpper(login[:1])+login[1:]+"-demo", org, role, now); err != nil {
			return err
		}
	}
	return nil
}
