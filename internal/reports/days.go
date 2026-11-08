package reports

import (
	"context"
	"database/sql"
	"sort"
	"time"

	"legkyi/internal/core"
)

// Daily reports (Go-owned tables report_days and report_day_items, see internal/store/schema.go).
//
// A month (reports row) is either kept as a whole (no report_days rows: the behaviour from before daily reports,
// report_items holds the quantities and the month is submitted at once) or kept by days. The first day saved for a
// month turns it into a daily one: quantities it already had move into the undated bucket («без дати», day ''), so
// nothing entered before is lost. From then on report_items is the month's aggregate: for the products a store can
// edit it is rebuilt from the days in the same transaction as every day save. Each day has its own status and
// signatures; the month's status is derived (submitted when every day is).

// Undated is the bucket of quantities entered for the whole month before the month was kept by days.
const Undated = ""

// UndatedToken names the undated bucket in URLs and JSON.
const UndatedToken = "undated"

// Day is one day of a monthly report.
type Day struct {
	Day    string // YYYY-MM-DD or Undated
	Status string // draft | submitted
	Signatures
	// Missed: the store had not submitted the day by midnight (stays after a late submission).
	Missed bool
	// AutoLocked: when the day was last closed automatically at midnight (zero = never).
	AutoLocked time.Time
}

// DayTotal is a day with the money and line count of its quantities.
type DayTotal struct {
	Day
	Total int64
	Count int
}

const dayColumns = `day, status, COALESCE(submitted_by_id, 0), submitted_by_name, submitted_at, COALESCE(locked_by_id, 0), locked_by_name, locked_at, missed, auto_locked_at`

func scanDay(scan func(...any) error) (Day, error) {
	var d Day
	var sub, lock Signature
	var subAt, lockAt, autoAt int64
	var missed int
	if err := scan(&d.Day, &d.Status, &sub.ByID, &sub.ByName, &subAt, &lock.ByID, &lock.ByName, &lockAt, &missed, &autoAt); err != nil {
		return d, err
	}
	d.Missed = missed != 0
	if autoAt > 0 {
		d.AutoLocked = time.Unix(autoAt, 0)
	}
	if subAt > 0 {
		sub.At = time.Unix(subAt, 0)
		d.Submitted = &sub
	}
	if lockAt > 0 {
		lock.At = time.Unix(lockAt, 0)
		d.Locked = &lock
	}
	return d, nil
}

// IsDaily reports whether the month is kept by days.
func IsDaily(ctx context.Context, q core.Querier, reportID int64) (bool, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM report_days WHERE report_id = ?", reportID).Scan(&n)
	return n > 0, err
}

// DailyReports returns the ids of the reports of a period that are kept by days.
func DailyReports(ctx context.Context, q core.Querier, period string) (map[int64]bool, error) {
	rows, err := q.QueryContext(ctx, "SELECT DISTINCT d.report_id FROM report_days d JOIN reports r ON r.id = d.report_id WHERE r.period = ?", period)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// LoadDay returns one day of a report, or nil when it has none.
func LoadDay(ctx context.Context, q core.Querier, reportID int64, day string) (*Day, error) {
	row := q.QueryRowContext(ctx, "SELECT "+dayColumns+" FROM report_days WHERE report_id = ? AND day = ?", reportID, day)
	d, err := scanDay(row.Scan)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// DayTotals returns every day of a report with its totals, undated first, then by date.
func DayTotals(ctx context.Context, q core.Querier, reportID int64) ([]DayTotal, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+dayColumns+" FROM report_days WHERE report_id = ? ORDER BY day", reportID)
	if err != nil {
		return nil, err
	}
	var out []DayTotal
	for rows.Next() {
		d, err := scanDay(rows.Scan)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, DayTotal{Day: d})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sums := map[string][2]int64{}
	srows, err := q.QueryContext(ctx, `SELECT day, COALESCE(SUM(quantity * unit_price_cents), 0), COUNT(id)
		FROM report_day_items WHERE report_id = ? GROUP BY day`, reportID)
	if err != nil {
		return nil, err
	}
	defer srows.Close()
	for srows.Next() {
		var day string
		var total, n int64
		if err := srows.Scan(&day, &total, &n); err != nil {
			return nil, err
		}
		sums[day] = [2]int64{total, n}
	}
	for i := range out {
		s := sums[out[i].Day.Day]
		out[i].Total, out[i].Count = s[0], int(s[1])
	}
	return out, srows.Err()
}

// LoadDayItems returns the quantities of one day.
func LoadDayItems(ctx context.Context, q core.Querier, reportID int64, day string) ([]Item, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, product_id, quantity, quantity_calc, unit_price_cents
		FROM report_day_items WHERE report_id = ? AND day = ? ORDER BY id`, reportID, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Item
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.ProductID, &it.Quantity, &it.QuantityCalc, &it.UnitPrice); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// MakeDaily turns a month kept as a whole into a daily one: its quantities (all products, inactive ones included)
// and its status and signatures move into the undated bucket. A month without quantities gets no undated bucket.
// Does nothing for a month that is already daily.
func MakeDaily(ctx context.Context, tx *sql.Tx, rep *Report) error {
	daily, err := IsDaily(ctx, tx, rep.ID)
	if err != nil || daily {
		return err
	}
	items, err := LoadItems(ctx, tx, rep.ID)
	if err != nil {
		return err
	}
	var keep []Item
	for _, it := range items {
		if it.Quantity != 0 || it.QuantityCalc != 0 {
			keep = append(keep, it)
		}
	}
	if len(keep) == 0 {
		return nil
	}
	sigs, err := SignaturesOf(ctx, tx, rep.ID)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO report_days (report_id, day, status) VALUES (?, ?, ?)", rep.ID, Undated, rep.Status); err != nil {
		return err
	}
	if s := sigs.Submitted; s != nil {
		if err := setDaySignature(ctx, tx, rep.ID, Undated, KindStore, s.ByID, s.ByName, s.At); err != nil {
			return err
		}
	}
	if s := sigs.Locked; s != nil {
		if err := setDaySignature(ctx, tx, rep.ID, Undated, KindAdmin, s.ByID, s.ByName, s.At); err != nil {
			return err
		}
	}
	for _, it := range keep {
		if _, err := tx.ExecContext(ctx, `INSERT INTO report_day_items (report_id, day, product_id, unit_price_cents, quantity, quantity_calc)
			VALUES (?, ?, ?, ?, ?, ?)`, rep.ID, Undated, it.ProductID, it.UnitPrice, it.Quantity, it.QuantityCalc); err != nil {
			return err
		}
	}
	return nil
}

// EnsureDay creates a draft day when the report has none for that date yet.
func EnsureDay(ctx context.Context, tx *sql.Tx, reportID int64, day string) error {
	_, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO report_days (report_id, day, status) VALUES (?, ?, 'draft')", reportID, day)
	return err
}

// SetDayStatus changes a day's status.
func SetDayStatus(ctx context.Context, tx *sql.Tx, reportID int64, day, status string) error {
	_, err := tx.ExecContext(ctx, "UPDATE report_days SET status = ? WHERE report_id = ? AND day = ?", status, reportID, day)
	return err
}

func setDaySignature(ctx context.Context, tx *sql.Tx, reportID int64, day, kind string, userID int64, userName string, at time.Time) error {
	q := "UPDATE report_days SET submitted_by_id = ?, submitted_by_name = ?, submitted_at = ? WHERE report_id = ? AND day = ?"
	if kind == KindAdmin {
		q = "UPDATE report_days SET locked_by_id = ?, locked_by_name = ?, locked_at = ? WHERE report_id = ? AND day = ?"
	}
	var uid any
	if userID > 0 {
		uid = userID
	}
	_, err := tx.ExecContext(ctx, q, uid, userName, at.Unix(), reportID, day)
	return err
}

// SignDay records who submitted (KindStore) or locked (KindAdmin) a day.
func SignDay(ctx context.Context, tx *sql.Tx, reportID int64, day, kind string, userID int64, userName string, now time.Time) error {
	return setDaySignature(ctx, tx, reportID, day, kind, userID, userName, now)
}

// ReplaceDayItems replaces the day's rows of editable products with the new quantities ({product: {price: (qty,
// calc)}}); rows of other products stay. Rows with both quantities 0 are not stored.
func ReplaceDayItems(ctx context.Context, tx *sql.Tx, reportID int64, day string, editable map[int64]bool, items []Item, quantities map[int64]map[int64][2]int64) error {
	for _, it := range items {
		if editable[it.ProductID] {
			if _, err := tx.ExecContext(ctx, "DELETE FROM report_day_items WHERE id = ?", it.ID); err != nil {
				return err
			}
		}
	}
	pids := make([]int64, 0, len(quantities))
	for pid := range quantities {
		if editable[pid] {
			pids = append(pids, pid)
		}
	}
	sort.Slice(pids, func(i, j int) bool { return pids[i] < pids[j] })
	for _, pid := range pids {
		prices := make([]int64, 0, len(quantities[pid]))
		for p := range quantities[pid] {
			prices = append(prices, p)
		}
		sort.Slice(prices, func(i, j int) bool { return prices[i] < prices[j] })
		for _, price := range prices {
			qty := quantities[pid][price]
			if qty[0] == 0 && qty[1] == 0 {
				continue
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO report_day_items (report_id, day, product_id, unit_price_cents, quantity, quantity_calc)
				VALUES (?, ?, ?, ?, ?, ?)`, reportID, day, pid, price, qty[0], qty[1]); err != nil {
				return err
			}
		}
	}
	return nil
}

// RebuildAggregate makes the month's report_items rows of editable products equal to the sum of its days. Rows of
// other products are left as they are (their day rows never change either, so they stay equal).
func RebuildAggregate(ctx context.Context, tx *sql.Tx, reportID int64, editable map[int64]bool) error {
	items, err := LoadItems(ctx, tx, reportID)
	if err != nil {
		return err
	}
	for _, it := range items {
		if editable[it.ProductID] {
			if _, err := tx.ExecContext(ctx, "DELETE FROM report_items WHERE id = ?", it.ID); err != nil {
				return err
			}
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT product_id, unit_price_cents, SUM(quantity), SUM(quantity_calc)
		FROM report_day_items WHERE report_id = ? GROUP BY product_id, unit_price_cents ORDER BY product_id, unit_price_cents`, reportID)
	if err != nil {
		return err
	}
	type agg struct{ pid, price, qty, calc int64 }
	var sums []agg
	for rows.Next() {
		var a agg
		if err := rows.Scan(&a.pid, &a.price, &a.qty, &a.calc); err != nil {
			rows.Close()
			return err
		}
		sums = append(sums, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, s := range sums {
		if !editable[s.pid] || (s.qty == 0 && s.calc == 0) {
			continue
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO report_items (report_id, product_id, quantity, quantity_calc, unit_price_cents) VALUES (?, ?, ?, ?, ?)",
			reportID, s.pid, s.qty, s.calc, s.price); err != nil {
			return err
		}
	}
	return nil
}

// SyncMonthStatus derives a daily month's status from its days: submitted when every day is, else draft. A month
// kept as a whole keeps its own status. Returns the month's status.
func SyncMonthStatus(ctx context.Context, tx *sql.Tx, rep *Report) (string, error) {
	var total, submitted int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*), COALESCE(SUM(status = 'submitted'), 0) FROM report_days WHERE report_id = ?", rep.ID).Scan(&total, &submitted); err != nil {
		return "", err
	}
	if total == 0 {
		return rep.Status, nil
	}
	status := "draft"
	if submitted == total {
		status = "submitted"
	}
	if status != rep.Status {
		if _, err := tx.ExecContext(ctx, "UPDATE reports SET status = ? WHERE id = ?", status, rep.ID); err != nil {
			return "", err
		}
		rep.Status = status
	}
	return status, nil
}

// statusItemsSQL lists every saved quantity with the status that decides whether it counts as submitted: a month
// kept as a whole carries the month's status (day ”), a daily month each day's own (its report_items rows are the
// aggregate of these and are skipped). Columns: report_id, store_id, period, day, product_id, quantity,
// quantity_calc, unit_price_cents, status.
const statusItemsSQL = `SELECT r.id AS report_id, r.store_id AS store_id, r.period AS period, '' AS day, i.product_id AS product_id,
		i.quantity AS quantity, i.quantity_calc AS quantity_calc, i.unit_price_cents AS unit_price_cents, r.status AS status
	FROM report_items i JOIN reports r ON r.id = i.report_id
	WHERE NOT EXISTS (SELECT 1 FROM report_days d WHERE d.report_id = r.id)
	UNION ALL
	SELECT r.id, r.store_id, r.period, x.day, x.product_id, x.quantity, x.quantity_calc, x.unit_price_cents, d.status
	FROM report_day_items x JOIN report_days d ON d.report_id = x.report_id AND d.day = x.day JOIN reports r ON r.id = x.report_id`
