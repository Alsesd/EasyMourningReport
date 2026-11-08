package reports

import (
	"context"
	"database/sql"
	"sort"
	"strings"

	"legkyi/internal/core"
)

type Product struct {
	ID         int64
	Name       string
	PriceCents int64
	Active     bool
	Archived   bool
}

// InForm: products that appear in new report forms.
func (p Product) InForm() bool { return p.Active && !p.Archived }

type Report struct {
	ID      int64
	StoreID int64
	Period  string
	Status  string // "draft" | "submitted"
}

type Item struct {
	ID           int64
	ProductID    int64
	Quantity     int64
	QuantityCalc int64
	UnitPrice    int64
}

// LoadProducts returns products ordered by name (SQL binary collation, as Python).
func LoadProducts(ctx context.Context, q core.Querier, where string, args ...any) ([]Product, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, name, price_cents, active, archived FROM products "+where+" ORDER BY name", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Product
	for rows.Next() {
		var p Product
		var a, ar int
		if err := rows.Scan(&p.ID, &p.Name, &p.PriceCents, &a, &ar); err != nil {
			return nil, err
		}
		p.Active, p.Archived = a != 0, ar != 0
		out = append(out, p)
	}
	return out, rows.Err()
}

func LoadProduct(ctx context.Context, q core.Querier, id int64) (*Product, error) {
	l, err := LoadProducts(ctx, q, "WHERE id = ?", id)
	if err != nil || len(l) == 0 {
		return nil, err
	}
	return &l[0], nil
}

// LoadHistory: product id -> sorted price history.
func LoadHistory(ctx context.Context, q core.Querier) (map[int64]History, error) {
	rows, err := q.QueryContext(ctx, "SELECT product_id, period, price_cents FROM product_prices ORDER BY period")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]History{}
	for rows.Next() {
		var pid, c int64
		var period string
		if err := rows.Scan(&pid, &period, &c); err != nil {
			return nil, err
		}
		out[pid] = append(out[pid], PricePoint{period, c})
	}
	for pid, h := range out {
		out[pid] = SortHistory(h)
	}
	return out, rows.Err()
}

// HistoryOf falls back to the product's own price when it has no history rows.
func HistoryOf(all map[int64]History, p Product) History {
	if h := all[p.ID]; len(h) > 0 {
		return SortHistory(h)
	}
	return History{{BasePeriod, p.PriceCents}}
}

// SaveHistory makes the stored rows equal to the wanted history (update, delete, insert).
func SaveHistory(ctx context.Context, tx *sql.Tx, pid int64, wanted History) error {
	rows, err := tx.QueryContext(ctx, "SELECT period FROM product_prices WHERE product_id = ?", pid)
	if err != nil {
		return err
	}
	have := map[string]bool{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			rows.Close()
			return err
		}
		have[p] = true
	}
	rows.Close()
	want := map[string]int64{}
	for _, w := range wanted {
		want[w.Period] = w.Cents
	}
	for period := range have {
		if c, ok := want[period]; ok {
			if _, err := tx.ExecContext(ctx, "UPDATE product_prices SET price_cents = ? WHERE product_id = ? AND period = ?", c, pid, period); err != nil {
				return err
			}
		} else if _, err := tx.ExecContext(ctx, "DELETE FROM product_prices WHERE product_id = ? AND period = ?", pid, period); err != nil {
			return err
		}
	}
	for _, w := range wanted {
		if !have[w.Period] {
			if _, err := tx.ExecContext(ctx, "INSERT INTO product_prices (product_id, period, price_cents) VALUES (?, ?, ?)", pid, w.Period, w.Cents); err != nil {
				return err
			}
		}
	}
	return nil
}

// ProductUsage counts report rows per product.
func ProductUsage(ctx context.Context, q core.Querier) (map[int64]int, error) {
	rows, err := q.QueryContext(ctx, "SELECT product_id, COUNT(id) FROM report_items GROUP BY product_id")
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

// --- settings --------------------------------------------------------------------------

func CalculationEnabledIDs(ctx context.Context, q core.Querier) (map[int64]bool, error) {
	rows, err := q.QueryContext(ctx, "SELECT organisation_id FROM report_settings WHERE calculation_enabled != 0")
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

func CalculationEnabled(ctx context.Context, q core.Querier, org int64) (bool, error) {
	var v int
	err := q.QueryRowContext(ctx, "SELECT calculation_enabled FROM report_settings WHERE organisation_id = ?", org).Scan(&v)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return v != 0, err
}

func SetCalculationEnabled(ctx context.Context, tx *sql.Tx, org int64, enabled bool) error {
	v := 0
	if enabled {
		v = 1
	}
	res, err := tx.ExecContext(ctx, "UPDATE report_settings SET calculation_enabled = ? WHERE organisation_id = ?", v, org)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		_, err = tx.ExecContext(ctx, "INSERT INTO report_settings (organisation_id, calculation_enabled) VALUES (?, ?)", org, v)
	}
	return err
}

// --- reports ---------------------------------------------------------------------------

func StorePeriods(ctx context.Context, q core.Querier, store int64) (map[string]bool, error) {
	rows, err := q.QueryContext(ctx, "SELECT period FROM reports WHERE store_id = ?", store)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out[p] = true
	}
	return out, rows.Err()
}

func scanReport(row *sql.Row) (*Report, error) {
	var r Report
	err := row.Scan(&r.ID, &r.StoreID, &r.Period, &r.Status)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &r, err
}

func FindReport(ctx context.Context, q core.Querier, store int64, period string) (*Report, error) {
	return scanReport(q.QueryRowContext(ctx, "SELECT id, store_id, period, status FROM reports WHERE store_id = ? AND period = ?", store, period))
}

func GetReport(ctx context.Context, q core.Querier, id int64) (*Report, error) {
	return scanReport(q.QueryRowContext(ctx, "SELECT id, store_id, period, status FROM reports WHERE id = ?", id))
}

func LoadItems(ctx context.Context, q core.Querier, reportID int64) ([]Item, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, product_id, quantity, quantity_calc, unit_price_cents FROM report_items WHERE report_id = ? ORDER BY id", reportID)
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

// ReportTotal: financial totals use the ordinary quantity, never the calculation quantity.
func ReportTotal(items []Item) int64 {
	var s int64
	for _, i := range items {
		s += i.Quantity * i.UnitPrice
	}
	return s
}

// --- lines and summary -----------------------------------------------------------------

type InputRow struct {
	Price, Qty, QtyCalc int64
	Label               string
}

type LineRow struct {
	ID       int64
	Name     string
	Inputs   []InputRow
	Repriced bool
	Sum      int64
}

type InactiveRow struct {
	Name     string
	Archived bool
	Lines    string
	Sum      int64
}

func sortedKeys(m map[int64]int64) []int64 {
	out := make([]int64, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// BuildLines builds the report form rows for a period, keeping the two quantities independent.
func BuildLines(ctx context.Context, q core.Querier, period string, items []Item, calcEnabled bool) ([]LineRow, []InactiveRow, int64, error) {
	history, err := LoadHistory(ctx, q)
	if err != nil {
		return nil, nil, 0, err
	}
	products, err := LoadProducts(ctx, q, "")
	if err != nil {
		return nil, nil, 0, err
	}
	saved, savedCalc := map[int64]map[int64]int64{}, map[int64]map[int64]int64{}
	for _, it := range items {
		if saved[it.ProductID] == nil {
			saved[it.ProductID], savedCalc[it.ProductID] = map[int64]int64{}, map[int64]int64{}
		}
		saved[it.ProductID][it.UnitPrice] += it.Quantity
		savedCalc[it.ProductID][it.UnitPrice] += it.QuantityCalc
	}
	rows, inactive := []LineRow{}, []InactiveRow{}
	var inactiveTotal int64
	for _, p := range products {
		sp, cp := saved[p.ID], savedCalc[p.ID]
		union := map[int64]int64{}
		for k := range sp {
			union[k] = 0
		}
		for k := range cp {
			union[k] = 0
		}
		if p.InForm() {
			derived := OfferedPrices(HistoryOf(history, p), period)
			var extra []int64
			for _, pr := range sortedKeys(union) {
				if !contains(derived, pr) && (sp[pr] > 0 || cp[pr] > 0) {
					extra = append(extra, pr)
				}
			}
			row := LineRow{ID: p.ID, Name: p.Name, Repriced: len(derived) > 1, Inputs: []InputRow{}}
			for _, l := range LineLabels(derived, extra) {
				in := InputRow{Price: l.Price, Qty: sp[l.Price], QtyCalc: cp[l.Price], Label: l.Label}
				row.Inputs = append(row.Inputs, in)
				row.Sum += in.Price * in.Qty
			}
			rows = append(rows, row)
			continue
		}
		var prices []int64
		for _, pr := range sortedKeys(union) {
			if sp[pr] > 0 || cp[pr] > 0 {
				prices = append(prices, pr)
			}
		}
		var parts []string
		for _, pr := range prices {
			if sp[pr] != 0 {
				parts = append(parts, itoa(sp[pr])+" × "+FormatMoney(pr))
			}
			if calcEnabled && cp[pr] != 0 {
				parts = append(parts, "по розрахунку: "+itoa(cp[pr])+" × "+FormatMoney(pr))
			}
		}
		if len(prices) > 0 && len(parts) > 0 {
			var sum int64
			for pr, qn := range sp {
				sum += pr * qn
			}
			inactive = append(inactive, InactiveRow{Name: p.Name, Archived: p.Archived, Lines: strings.Join(parts, "; "), Sum: sum})
			inactiveTotal += sum
		}
	}
	return rows, inactive, inactiveTotal, nil
}

func itoa(n int64) string { return FormatInt(n) }

type SummaryStore struct {
	ID                 int64
	Name               string
	Archived           bool
	CalculationEnabled bool
}

type SummaryRow struct {
	Name             string
	Note             string
	Price            int64
	Label            string
	Cells            []int64
	CalculationCells []int64
	Qty, CalcQty     int64
	Sum              int64
}

type Summary struct {
	Stores      []SummaryStore
	Rows        []SummaryRow
	StoreTotals []int64
	Grand       int64
}

type cellKey struct{ pid, price, sid int64 }

// BuildSummary aggregates saved quantities of a period per product, price and store.
func BuildSummary(ctx context.Context, q core.Querier, period string, submittedOnly bool) (*Summary, error) {
	return BuildSummaryFor(ctx, q, period, "", submittedOnly)
}

// BuildSummaryFor is BuildSummary for the whole month (day "") or one day (YYYY-MM-DD) of it. Submitted only means
// submitted months for months kept as a whole and submitted days for months kept by days.
func BuildSummaryFor(ctx context.Context, q core.Querier, period, day string, submittedOnly bool) (*Summary, error) {
	query := `SELECT r.store_id, i.product_id, i.quantity, i.quantity_calc, i.unit_price_cents
		FROM report_items i JOIN reports r ON i.report_id = r.id WHERE r.period = ?`
	args := []any{period}
	if submittedOnly || day != "" {
		query = "SELECT s.store_id, s.product_id, s.quantity, s.quantity_calc, s.unit_price_cents FROM (" + statusItemsSQL + ") s WHERE s.period = ?"
		if day != "" {
			query += " AND s.day = ?"
			args = append(args, day)
		}
		if submittedOnly {
			query += " AND s.status = 'submitted'"
		}
	}
	rs, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	enabled, err := CalculationEnabledIDs(ctx, q)
	if err != nil {
		rs.Close()
		return nil, err
	}
	qty, calc, amt := map[cellKey]int64{}, map[cellKey]int64{}, map[cellKey]int64{}
	dataPids, dataSids := map[int64]bool{}, map[int64]bool{}
	dataPrices := map[int64]map[int64]bool{}
	for rs.Next() {
		var sid, pid, n, cn, price int64
		if err := rs.Scan(&sid, &pid, &n, &cn, &price); err != nil {
			rs.Close()
			return nil, err
		}
		k := cellKey{pid, price, sid}
		qty[k] += n
		calc[k] += cn
		amt[k] += n * price
		if n != 0 || (cn != 0 && enabled[sid]) {
			dataPids[pid], dataSids[sid] = true, true
			if dataPrices[pid] == nil {
				dataPrices[pid] = map[int64]bool{}
			}
			dataPrices[pid][price] = true
		}
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}
	orgRows, err := q.QueryContext(ctx, "SELECT id, name, archived FROM organisations ORDER BY name")
	if err != nil {
		return nil, err
	}
	sum := &Summary{Stores: []SummaryStore{}, Rows: []SummaryRow{}, StoreTotals: []int64{}}
	for orgRows.Next() {
		var s SummaryStore
		var arch int
		if err := orgRows.Scan(&s.ID, &s.Name, &arch); err != nil {
			orgRows.Close()
			return nil, err
		}
		s.Archived, s.CalculationEnabled = arch != 0, enabled[s.ID]
		if !s.Archived || dataSids[s.ID] {
			sum.Stores = append(sum.Stores, s)
		}
	}
	orgRows.Close()
	history, err := LoadHistory(ctx, q)
	if err != nil {
		return nil, err
	}
	all, err := LoadProducts(ctx, q, "")
	if err != nil {
		return nil, err
	}
	for _, p := range all {
		if !p.InForm() && !dataPids[p.ID] {
			continue
		}
		offered := OfferedPrices(HistoryOf(history, p), period)
		var extra []int64
		for _, pr := range sortedBool(dataPrices[p.ID]) {
			if !contains(offered, pr) {
				extra = append(extra, pr)
			}
		}
		prices := append(append([]int64(nil), offered...), extra...)
		labelBy := map[int64]string{}
		for _, l := range LineLabels(offered, extra) {
			labelBy[l.Price] = l.Label
		}
		for _, price := range prices {
			row := SummaryRow{Name: p.Name, Price: price, Label: labelBy[price], Cells: []int64{}, CalculationCells: []int64{}}
			for _, s := range sum.Stores {
				k := cellKey{p.ID, price, s.ID}
				row.Cells = append(row.Cells, qty[k])
				c := int64(0)
				if s.CalculationEnabled {
					c = calc[k]
				}
				row.CalculationCells = append(row.CalculationCells, c)
				row.Qty += qty[k]
				row.CalcQty += c
				row.Sum += amt[k]
			}
			if len(offered) >= 2 || row.Label == "saved" {
				names := map[string]string{"old": "стара ціна", "new": "нова ціна", "saved": "раніше збережена"}
				n := names[row.Label]
				if n == "" {
					n = "ціна"
				}
				row.Note = FormatMoney(price) + " · " + n
			}
			sum.Rows = append(sum.Rows, row)
		}
	}
	for _, s := range sum.Stores {
		var t int64
		for pid := range dataPids {
			for price := range dataPrices[pid] {
				t += amt[cellKey{pid, price, s.ID}]
			}
		}
		sum.StoreTotals = append(sum.StoreTotals, t)
		sum.Grand += t
	}
	return sum, nil
}

func sortedBool(m map[int64]bool) []int64 {
	out := make([]int64, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
