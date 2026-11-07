package transport

import (
	"context"
	"fmt"
	"sort"
	"time"

	"legkyi/internal/core"
)

// Dashboard is the transport side of the management dashboard. Orders belong to a month by their service date.
// The figures about the present (unclosed past orders, work ahead) ignore the selected month.
func Dashboard(ctx context.Context, q core.Querier, period string, now time.Time) ([]core.DashboardBlock, error) {
	first, err := time.ParseInLocation("2006-01", period, now.Location())
	if err != nil {
		return nil, core.HTTPError{Status: 400, Detail: "Некоректний місяць."}
	}
	last := first.AddDate(0, 1, -1)
	from, to := first.Format("2006-01-02"), last.Format("2006-01-02")

	// Status mix of the month.
	counts := map[string]int{}
	military := 0
	rows, err := q.QueryContext(ctx, `SELECT status, is_military, COUNT(*) FROM transport_orders WHERE service_date BETWEEN ? AND ? GROUP BY status, is_military`, from, to)
	if err != nil {
		return nil, err
	}
	total := 0
	for rows.Next() {
		var st string
		var mil, n int
		if err := rows.Scan(&st, &mil, &n); err != nil {
			rows.Close()
			return nil, err
		}
		counts[st] += n
		total += n
		if mil == 1 {
			military += n
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	donePct := 0.0
	if total > 0 {
		donePct = float64(counts[Done]) * 100 / float64(total)
	}

	// Cars taken by military orders in the month (events are stamped in unix seconds).
	var bumped int
	if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM transport_order_events WHERE kind = 'bumped' AND ts >= ? AND ts < ?`,
		first.Unix(), first.AddDate(0, 1, 0).Unix()).Scan(&bumped); err != nil {
		return nil, err
	}

	// Time to the dispatcher's first answer (accepted or rejected; a desk cancelling is not an answer).
	var waits []float64
	wr, err := q.QueryContext(ctx, `SELECT o.created_at, MIN(e.ts) FROM transport_orders o
		JOIN transport_order_events e ON e.order_id = o.id AND e.kind = 'status' AND e.status IN ('accepted', 'rejected')
		WHERE o.service_date BETWEEN ? AND ? GROUP BY o.id`, from, to)
	if err != nil {
		return nil, err
	}
	for wr.Next() {
		var created, replied int64
		if err := wr.Scan(&created, &replied); err != nil {
			wr.Close()
			return nil, err
		}
		if d := float64(replied-created) / 60; d >= 0 {
			waits = append(waits, d)
		}
	}
	wr.Close()
	if err := wr.Err(); err != nil {
		return nil, err
	}

	month := core.DashboardBlock{Key: "transport", Title: "Транспорт за місяць", Description: "Замовлення належать місяцю за днем виконання.",
		Tiles: []core.DashTile{
			{Label: "Замовлень", Value: float64(total), Unit: core.UnitCount, Hint: "за днем виконання"},
			{Label: "Виконано", Value: donePct, Unit: core.UnitPercent, Hint: fmt.Sprintf("%d із %d", counts[Done], total)},
			{Label: "Відхилено", Value: float64(counts[Rejected]), Unit: core.UnitCount},
			{Label: "Скасовано підрозділами", Value: float64(counts[Cancelled]), Unit: core.UnitCount},
			{Label: "Військові", Value: float64(military), Unit: core.UnitCount, Hint: "замовлень із пріоритетом"},
			{Label: "Авто знято", Value: float64(bumped), Unit: core.UnitCount, Hint: "військовими замовленнями"},
		},
	}
	if len(waits) > 0 {
		sort.Float64s(waits)
		mid := waits[len(waits)/2]
		if len(waits)%2 == 0 {
			mid = (waits[len(waits)/2-1] + waits[len(waits)/2]) / 2
		}
		month.Tiles = append(month.Tiles, core.DashTile{Label: "Час до відповіді диспетчера", Value: mid, Unit: core.UnitMinutes, Hint: fmt.Sprintf("медіана, відповідей: %d", len(waits))})
	}

	// Orders per day of the month.
	perDay := map[string]int{}
	dr, err := q.QueryContext(ctx, `SELECT service_date, COUNT(*) FROM transport_orders WHERE service_date BETWEEN ? AND ? GROUP BY service_date`, from, to)
	if err != nil {
		return nil, err
	}
	for dr.Next() {
		var d string
		var n int
		if err := dr.Scan(&d, &n); err != nil {
			dr.Close()
			return nil, err
		}
		perDay[d] = n
	}
	dr.Close()
	if err := dr.Err(); err != nil {
		return nil, err
	}
	today := now.Format("2006-01-02")
	series := core.DashSeries{Title: "Замовлень по днях", Unit: core.UnitCount, Note: "Майбутні дні — уже подані замовлення."}
	for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		series.Points = append(series.Points, core.DashPoint{Label: fmt.Sprint(d.Day()), Value: float64(perDay[key]), Partial: key > today})
	}
	month.Series = []core.DashSeries{series}

	byOrg := core.DashList{Title: "Замовлення по підрозділах", Unit: core.UnitCount}
	or, err := q.QueryContext(ctx, `SELECT org.name, COUNT(*), SUM(CASE WHEN o.status = 'done' THEN 1 ELSE 0 END)
		FROM transport_orders o JOIN organisations org ON org.id = o.organisation_id
		WHERE o.service_date BETWEEN ? AND ? GROUP BY org.id, org.name ORDER BY COUNT(*) DESC, org.name LIMIT 12`, from, to)
	if err != nil {
		return nil, err
	}
	for or.Next() {
		var r core.DashRow
		var done int
		if err := or.Scan(&r.Label, &r.Value, &done); err != nil {
			or.Close()
			return nil, err
		}
		r.Hint = fmt.Sprintf("виконано %d", done)
		byOrg.Rows = append(byOrg.Rows, r)
	}
	or.Close()
	if err := or.Err(); err != nil {
		return nil, err
	}
	month.Lists = []core.DashList{byOrg}

	// The present: open orders of past days (never closed), of today, and ahead.
	var overdue, todayOpen, ahead int
	if err := q.QueryRowContext(ctx, `SELECT
		COALESCE(SUM(CASE WHEN service_date < ? THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN service_date = ? THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN service_date > ? THEN 1 ELSE 0 END), 0)
		FROM transport_orders WHERE status IN ('submitted', 'accepted', 'in_progress', 'bumped')`, today, today, today).Scan(&overdue, &todayOpen, &ahead); err != nil {
		return nil, err
	}
	overdueTone := ""
	if overdue > 0 {
		overdueTone = "alert"
	}
	present := core.DashboardBlock{Key: "transport-now", Title: "Транспорт зараз", Description: "Поточний стан, не залежить від вибраного місяця.",
		Tiles: []core.DashTile{
			{Label: "Незакриті за минулі дні", Value: float64(overdue), Unit: core.UnitCount, Tone: overdueTone, Hint: "потребують закриття"},
			{Label: "У роботі сьогодні", Value: float64(todayOpen), Unit: core.UnitCount},
			{Label: "У роботі на наступні дні", Value: float64(ahead), Unit: core.UnitCount, Hint: "оформлені заздалегідь"},
		},
	}
	return []core.DashboardBlock{present, month}, nil
}
