package transport

import (
	"context"
	"database/sql"
	"strconv"
	"strings"

	"legkyi/internal/core"
)

// CargoLine is a quantity of one requested item that rides on an order (OrderID) or at a run stop (RunStopID).
type CargoLine struct {
	ID, ItemID, RequestID int64
	OrganisationID        int64 // the desk that ordered it = the destination
	OrganisationName      string
	ProductName           string
	Quantity              int64
	UnitPriceCents        *int64 // the request item's price snapshot; nil = no price
	OrderID, RunStopID    int64
}

const cargoSelect = `SELECT c.id, c.item_id, i.request_id, r.organisation_id, org.name, i.product_name, c.quantity, i.unit_price_cents,
		COALESCE(c.order_id, 0), COALESCE(c.run_stop_id, 0)
	FROM transport_cargo c
	JOIN product_request_items i ON i.id = c.item_id
	JOIN product_requests r ON r.id = i.request_id
	JOIN organisations org ON org.id = r.organisation_id `

func loadCargo(ctx context.Context, q core.Querier, where string, args ...any) ([]CargoLine, error) {
	rows, err := q.QueryContext(ctx, cargoSelect+where+" ORDER BY c.id", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CargoLine
	for rows.Next() {
		var l CargoLine
		var price sql.NullInt64
		if err := rows.Scan(&l.ID, &l.ItemID, &l.RequestID, &l.OrganisationID, &l.OrganisationName, &l.ProductName, &l.Quantity, &price, &l.OrderID, &l.RunStopID); err != nil {
			return nil, err
		}
		if price.Valid {
			l.UnitPriceCents = &price.Int64
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// TotalCents is quantity times the unit price (nil without a price).
func (l CargoLine) TotalCents() *int64 {
	if l.UnitPriceCents == nil {
		return nil
	}
	t := l.Quantity * *l.UnitPriceCents
	return &t
}

// inClause makes "(?, ?, ?)" and its arguments.
func inClause(ids []int64) (string, []any) {
	if len(ids) == 0 {
		return "(NULL)", nil
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return "(" + strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",") + ")", args
}

// attachCargo fills Order.Cargo for the orders with one query.
func attachCargo(ctx context.Context, q core.Querier, orders []Order) error {
	if len(orders) == 0 {
		return nil
	}
	ids := make([]int64, len(orders))
	for i, o := range orders {
		ids[i] = o.ID
	}
	in, args := inClause(ids)
	lines, err := loadCargo(ctx, q, "WHERE c.order_id IN "+in, args...)
	if err != nil {
		return err
	}
	by := map[int64][]CargoLine{}
	for _, l := range lines {
		by[l.OrderID] = append(by[l.OrderID], l)
	}
	for i := range orders {
		orders[i].Cargo = by[orders[i].ID]
	}
	return nil
}

// Line is one wanted cargo line of a request body: how many of a request item.
type Line struct{ ItemID, Quantity int64 }

// loadedStatuses are the carrier states in which cargo no longer counts as loaded: the order was rejected or
// cancelled, or the run was cancelled, so the quantity is free again.
const (
	activeCargoSQL = `((c.order_id IS NOT NULL AND o.status NOT IN ('rejected', 'cancelled'))
		OR (c.run_stop_id IS NOT NULL AND ru.status != 'cancelled'))`
	cargoJoinSQL = ` LEFT JOIN transport_orders o ON o.id = c.order_id
		LEFT JOIN transport_run_stops st ON st.id = c.run_stop_id
		LEFT JOIN transport_runs ru ON ru.id = st.run_id `
)

// loadedOf sums the active cargo per request item.
func loadedOf(ctx context.Context, q core.Querier, itemIDs []int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	if len(itemIDs) == 0 {
		return out, nil
	}
	in, args := inClause(itemIDs)
	rows, err := q.QueryContext(ctx, `SELECT c.item_id, SUM(c.quantity) FROM transport_cargo c`+cargoJoinSQL+
		`WHERE c.item_id IN `+in+` AND `+activeCargoSQL+` GROUP BY c.item_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, n int64
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// placeCargo stores lines on one carrier (an order or a run stop) for the destination organisation. The caller has
// already removed the carrier's previous cargo inside the same write transaction, so the remaining quantity it
// computes here never counts the carrier's own earlier lines. It refuses (409/422) a line whose item belongs to
// another organisation, whose request is cancelled or rejected, or that asks for more than is left.
func placeCargo(ctx context.Context, tx *sql.Tx, destOrg int64, orderID, runStopID int64, lines []Line) error {
	merged := map[int64]int64{}
	var order []int64
	for _, l := range lines {
		if l.Quantity <= 0 {
			return core.FormError{Message: "Кількість має бути більшою за нуль."}
		}
		if _, ok := merged[l.ItemID]; !ok {
			order = append(order, l.ItemID)
		}
		merged[l.ItemID] += l.Quantity
	}
	loaded, err := loadedOf(ctx, tx, order)
	if err != nil {
		return err
	}
	for _, id := range order {
		var org, qty int64
		var name, status string
		err := tx.QueryRowContext(ctx, `SELECT r.organisation_id, i.quantity, i.product_name, r.status FROM product_request_items i
			JOIN product_requests r ON r.id = i.request_id WHERE i.id = ?`, id).Scan(&org, &qty, &name, &status)
		if err == sql.ErrNoRows {
			return core.FormError{Message: "Позицію заявки не знайдено."}
		}
		if err != nil {
			return err
		}
		if org != destOrg {
			return core.FormError{Message: "«" + name + "» замовлено для іншого підрозділу, ніж пункт призначення."}
		}
		if status != RequestSubmitted {
			return core.HTTPError{Status: 409, Detail: "Заявку на «" + name + "» скасовано або відхилено."}
		}
		if left := qty - loaded[id]; merged[id] > left {
			return core.FormError{Message: "«" + name + "»: можна додати не більше ніж залишилось (" + itoa(left) + ")."}
		}
		if orderID != 0 {
			_, err = tx.ExecContext(ctx, "INSERT INTO transport_cargo (item_id, quantity, order_id) VALUES (?, ?, ?)", id, merged[id], orderID)
		} else {
			_, err = tx.ExecContext(ctx, "INSERT INTO transport_cargo (item_id, quantity, run_stop_id) VALUES (?, ?, ?)", id, merged[id], runStopID)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
