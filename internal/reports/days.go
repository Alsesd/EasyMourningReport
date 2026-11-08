package reports

import (
	"context"
	"database/sql"
	"sort"
	"time"

	"legkyi/internal/core"
)

// Daily reports (tables report_days and report_day_items, see internal/store/schema.go).
//
// A store fills in each day of a month; report_items is the month's aggregate (the sum of the days, rebuilt for the
// products a store can edit in the same transaction as every day save), so the summary, the Excel export and the
// dashboard read the month directly. Each day has its own status and signatures; the month's status is derived
// (submitted when every day is).

// Day is one day of a monthly report.
type Day struct {
	Day    string // YYYY-MM-DD
	Status string // draft | submitted
	Signatures
	// Missed: the store had not submitted the day by midnight (stays after a late submission).
	Missed bool
	// AutoLocked: when the day was last closed automatically at midnight (zero = never).
	AutoLocked time.Time
	// Revision grows with every change of the day; Saved is the employee who saved it last.
	Revision int64
	Saved    *Signature
}

// DayTotal is a day with the money and line count of its quantities.
type DayTotal struct {
	Day
	Total int64
	Count int
}

const dayColumns = `day, status, COALESCE(submitted_by_id, 0), submitted_by_name, submitted_at, COALESCE(locked_by_id, 0), locked_by_name, locked_at, missed, auto_locked_at, revision, saved_by_name, saved_at`

func scanDay(scan func(...any) error) (Day, error) {
	var d Day
	var sub, lock Signature
	var subAt, lockAt, autoAt, savedAt int64
	var missed int
	var savedBy string
	if err := scan(&d.Day, &d.Status, &sub.ByID, &sub.ByName, &subAt, &lock.ByID, &lock.ByName, &lockAt, &missed, &autoAt, &d.Revision, &savedBy, &savedAt); err != nil {
		return d, err
	}
	if savedAt > 0 {
		d.Saved = &Signature{ByName: savedBy, At: time.Unix(savedAt, 0)}
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

// DayTotals returns every day of a report with its totals, by date.
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

// EnsureDay creates a draft day when the report has none for that date yet.
func EnsureDay(ctx context.Context, tx *sql.Tx, reportID int64, day string) error {
	_, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO report_days (report_id, day, status) VALUES (?, ?, 'draft')", reportID, day)
	return err
}

// SetDayStatus changes a day's status (a new revision).
func SetDayStatus(ctx context.Context, tx *sql.Tx, reportID int64, day, status string) error {
	_, err := tx.ExecContext(ctx, "UPDATE report_days SET status = ?, revision = revision + 1 WHERE report_id = ? AND day = ?", status, reportID, day)
	return err
}

// MarkDaySaved records a store employee's save of the day: a new revision and who saved it.
func MarkDaySaved(ctx context.Context, tx *sql.Tx, reportID int64, day, userName string, now time.Time) error {
	_, err := tx.ExecContext(ctx, "UPDATE report_days SET revision = revision + 1, saved_by_name = ?, saved_at = ? WHERE report_id = ? AND day = ?",
		userName, now.Unix(), reportID, day)
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

// SyncMonthStatus derives the month's status from its days: submitted when the store submitted every day (a day
// closed at midnight without a submission keeps the month a draft), else draft. Returns it.
func SyncMonthStatus(ctx context.Context, tx *sql.Tx, rep *Report) (string, error) {
	var total, submitted int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*), COALESCE(SUM(status = 'submitted' AND submitted_at > 0), 0) FROM report_days WHERE report_id = ?", rep.ID).Scan(&total, &submitted); err != nil {
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

// submittedByStore is the SQL condition (on report_days d) of a day that counts as submitted: locked AND submitted by
// the store. A day closed at midnight (or locked by a reviewer) without the store's submission does not count.
const submittedByStore = `d.status = 'submitted' AND d.submitted_at > 0`

// statusItemsSQL lists every saved quantity of every day with "submitted" when the day counts as submitted
// (submittedByStore) and "draft" otherwise. Columns: report_id, store_id, period, day, product_id, quantity,
// quantity_calc, unit_price_cents, status.
const statusItemsSQL = `SELECT r.id AS report_id, r.store_id AS store_id, r.period AS period, x.day AS day, x.product_id AS product_id,
		x.quantity AS quantity, x.quantity_calc AS quantity_calc, x.unit_price_cents AS unit_price_cents,
		CASE WHEN ` + submittedByStore + ` THEN 'submitted' ELSE 'draft' END AS status
	FROM report_day_items x JOIN report_days d ON d.report_id = x.report_id AND d.day = x.day JOIN reports r ON r.id = x.report_id`
