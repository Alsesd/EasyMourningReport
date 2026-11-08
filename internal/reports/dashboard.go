package reports

import (
	"context"
	"fmt"
	"time"

	"legkyi/internal/core"
)

// shiftMonth moves a YYYY-MM period by delta months.
func shiftMonth(period string, delta int) string {
	t, err := time.Parse("2006-01", period)
	if err != nil {
		return period
	}
	return t.AddDate(0, delta, 0).Format("2006-01")
}

var monthNames = [...]string{"січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"}

func monthLabel(period string) string {
	t, err := time.Parse("2006-01", period)
	if err != nil {
		return period
	}
	return fmt.Sprintf("%s %02d", monthNames[t.Month()-1], t.Year()%100)
}

// Dashboard is the money side of the management dashboard: confirmed (submitted) revenue per month, per division
// and per product. Revenue is quantity x unit price of the saved items, the same sum as the summary's grand total.
func Dashboard(ctx context.Context, q core.Querier, period string, now time.Time) ([]core.DashboardBlock, error) {
	const months = 12
	from := shiftMonth(period, -(months - 1))
	byMonth := map[string]map[string]int64{} // period -> status -> cents
	// A month kept by days counts its submitted days (statusItemsSQL), a month kept as a whole its own status.
	rows, err := q.QueryContext(ctx, `SELECT i.period, i.status, COALESCE(SUM(i.quantity * i.unit_price_cents), 0)
		FROM (`+statusItemsSQL+`) i
		WHERE i.period BETWEEN ? AND ? GROUP BY i.period, i.status`, from, period)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p, st string
		var c int64
		if err := rows.Scan(&p, &st, &c); err != nil {
			rows.Close()
			return nil, err
		}
		if byMonth[p] == nil {
			byMonth[p] = map[string]int64{}
		}
		byMonth[p][st] += c
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	current := now.Format("2006-01")
	series := core.DashSeries{Title: "Виручка за 12 місяців", Unit: core.UnitMoneyCents,
		Note: "Лише надіслані звіти. Поточний місяць ще не завершено."}
	for i := 0; i < months; i++ {
		p := shiftMonth(from, i)
		series.Points = append(series.Points, core.DashPoint{Label: monthLabel(p), Value: float64(byMonth[p]["submitted"]), Partial: p == current})
	}

	var orgs, submitted, drafts int
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM organisations WHERE archived = 0").Scan(&orgs); err != nil {
		return nil, err
	}
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM reports WHERE period = ? AND status = 'submitted'", period).Scan(&submitted); err != nil {
		return nil, err
	}
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM reports WHERE period = ? AND status = 'draft'", period).Scan(&drafts); err != nil {
		return nil, err
	}
	rate := 0.0
	if orgs > 0 {
		rate = float64(submitted) * 100 / float64(orgs)
	}

	block := core.DashboardBlock{Key: "reports", Title: "Звіти і виручка", Description: "Тільки надіслані (підтверджені) звіти; чернетки показані окремо.",
		Tiles: []core.DashTile{
			{Label: "Виручка за місяць", Value: float64(byMonth[period]["submitted"]), Unit: core.UnitMoneyCents, Hint: "надіслані звіти"},
			{Label: "У чернетках", Value: float64(byMonth[period]["draft"]), Unit: core.UnitMoneyCents, Hint: fmt.Sprintf("ще не надіслано, чернеток: %d", drafts)},
			{Label: "Звіти надіслано", Value: rate, Unit: core.UnitPercent, Hint: fmt.Sprintf("%d з %d підрозділів", submitted, orgs)},
		},
		Series: []core.DashSeries{series},
	}

	divisions := core.DashList{Title: "Виручка за місяць по підрозділах", Unit: core.UnitMoneyCents}
	drows, err := q.QueryContext(ctx, `SELECT o.name, SUM(i.quantity * i.unit_price_cents) AS total
		FROM (`+statusItemsSQL+`) i JOIN organisations o ON o.id = i.store_id
		WHERE i.period = ? AND i.status = 'submitted' GROUP BY o.id, o.name HAVING total > 0 ORDER BY total DESC, o.name LIMIT 12`, period)
	if err != nil {
		return nil, err
	}
	for drows.Next() {
		var r core.DashRow
		if err := drows.Scan(&r.Label, &r.Value); err != nil {
			drows.Close()
			return nil, err
		}
		divisions.Rows = append(divisions.Rows, r)
	}
	drows.Close()
	if err := drows.Err(); err != nil {
		return nil, err
	}

	top := core.DashList{Title: "Найбільша виручка по товарах", Unit: core.UnitMoneyCents}
	prows, err := q.QueryContext(ctx, `SELECT p.name, SUM(i.quantity), SUM(i.quantity * i.unit_price_cents) AS total
		FROM (`+statusItemsSQL+`) i JOIN products p ON p.id = i.product_id
		WHERE i.period = ? AND i.status = 'submitted' GROUP BY p.id, p.name HAVING total > 0 ORDER BY total DESC, p.name LIMIT 8`, period)
	if err != nil {
		return nil, err
	}
	for prows.Next() {
		var r core.DashRow
		var qty int64
		if err := prows.Scan(&r.Label, &qty, &r.Value); err != nil {
			prows.Close()
			return nil, err
		}
		r.Hint = fmt.Sprintf("%d шт.", qty)
		top.Rows = append(top.Rows, r)
	}
	prows.Close()
	if err := prows.Err(); err != nil {
		return nil, err
	}
	block.Lists = []core.DashList{divisions, top}
	return []core.DashboardBlock{block}, nil
}
