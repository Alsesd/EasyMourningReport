package reports

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"legkyi/internal/core"
)

var periodRE = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

// parsePeriod: empty means the current local month; otherwise YYYY-MM or a 400.
func (a *api) parsePeriod(p string) (string, error) {
	if p == "" {
		p = a.currentPeriod()
	}
	if !periodRE.MatchString(p) {
		return "", core.HTTPError{Status: 400, Detail: "Період має мати вигляд 2026-10"}
	}
	return p, nil
}

// --- DTOs (Pydantic field order) ----------------------------------------------------

type pricePointDTO struct {
	Period     string `json:"period"`
	PriceCents int64  `json:"price_cents"`
}

type productDTO struct {
	ID               int64           `json:"id"`
	Name             string          `json:"name"`
	PriceCents       int64           `json:"price_cents"`
	Active           bool            `json:"active"`
	Archived         bool            `json:"archived"`
	UsedCount        int             `json:"used_count"`
	MonthPricesCents []int64         `json:"month_prices_cents"`
	PriceHistory     []pricePointDTO `json:"price_history"`
}

type reportInputDTO struct {
	PriceCents   int64  `json:"price_cents"`
	Quantity     int64  `json:"quantity"`
	QuantityCalc int64  `json:"quantity_calc"`
	Label        string `json:"label"`
	SumCents     int64  `json:"sum_cents"`
}

type reportLineDTO struct {
	ID       int64            `json:"id"`
	Name     string           `json:"name"`
	Repriced bool             `json:"repriced"`
	SumCents int64            `json:"sum_cents"`
	Inputs   []reportInputDTO `json:"inputs"`
}

type inactiveLineDTO struct {
	Name     string `json:"name"`
	Archived bool   `json:"archived"`
	Lines    string `json:"lines"`
	SumCents int64  `json:"sum_cents"`
}

// signatureDTO is one person's mark on a report.
type signatureDTO struct {
	By string `json:"by"`
	At string `json:"signed_at"`
}

// signedDTO: the employee who submitted the report ("submission", kept after an unlock) and, only while the
// report is submitted and the lock is newer than that submission, the administrator who locked it again
// ("locked"). Both are absent for reports from before signatures were recorded.
type signedDTO struct {
	Submission *signatureDTO `json:"submission,omitempty"`
	Locked     *signatureDTO `json:"locked,omitempty"`
}

func signedOf(status string, s Signatures) signedDTO {
	var d signedDTO
	conv := func(x *Signature) *signatureDTO {
		if x == nil {
			return nil
		}
		return &signatureDTO{By: x.ByName, At: core.ServedTime(x.At)}
	}
	d.Submission = conv(s.Submitted)
	if status == "submitted" && s.Locked != nil && (s.Submitted == nil || s.Locked.At.After(s.Submitted.At)) {
		d.Locked = conv(s.Locked)
	}
	return d
}

type storeReportDTO struct {
	ReportID           *int64            `json:"report_id"`
	StoreName          string            `json:"store_name"`
	Period             string            `json:"period"`
	Status             string            `json:"status"`
	ReadOnly           bool              `json:"read_only"`
	CalculationEnabled bool              `json:"calculation_enabled"`
	Rows               []reportLineDTO   `json:"rows"`
	InactiveRows       []inactiveLineDTO `json:"inactive_rows"`
	InactiveTotalCents int64             `json:"inactive_total_cents"`
	TotalCents         int64             `json:"total_cents"`
	AvailablePeriods   []string          `json:"available_periods"`
	signedDTO
}

type adminReportListItemDTO struct {
	StoreID       int64  `json:"store_id"`
	StoreName     string `json:"store_name"`
	StoreArchived bool   `json:"store_archived"`
	ReportID      *int64 `json:"report_id"`
	Period        string `json:"period"`
	Status        string `json:"status"`
	TotalCents    int64  `json:"total_cents"`
	ItemCount     int    `json:"item_count"`
	signedDTO
	// Only for months kept by days: how many days have entries and how many of them are submitted.
	DaysCount     int `json:"days_count,omitempty"`
	DaysSubmitted int `json:"days_submitted,omitempty"`
}

type adminReportDTO struct {
	ReportID           int64  `json:"report_id"`
	StoreID            int64  `json:"store_id"`
	StoreName          string `json:"store_name"`
	StoreArchived      bool   `json:"store_archived"`
	CalculationEnabled bool   `json:"calculation_enabled"`
	Period             string `json:"period"`
	Status             string `json:"status"`
	TotalCents         int64  `json:"total_cents"`
	ItemCount          int    `json:"item_count"`
	signedDTO
}

type adminReportDetailDTO struct {
	adminReportDTO
	Rows               []reportLineDTO   `json:"rows"`
	InactiveRows       []inactiveLineDTO `json:"inactive_rows"`
	InactiveTotalCents int64             `json:"inactive_total_cents"`
}

type summaryStoreDTO struct {
	ID                 int64  `json:"id"`
	Name               string `json:"name"`
	Archived           bool   `json:"archived"`
	CalculationEnabled bool   `json:"calculation_enabled"`
}

type summaryRowDTO struct {
	Name                string  `json:"name"`
	Note                string  `json:"note"`
	PriceCents          int64   `json:"price_cents"`
	Label               string  `json:"label"`
	Cells               []int64 `json:"cells"`
	CalculationCells    []int64 `json:"calculation_cells"`
	Quantity            int64   `json:"quantity"`
	CalculationQuantity int64   `json:"calculation_quantity"`
	SumCents            int64   `json:"sum_cents"`
}

type summaryDTO struct {
	Period           string            `json:"period"`
	Day              string            `json:"day,omitempty"` // only for one day's summary
	SubmittedOnly    bool              `json:"submitted_only"`
	Stores           []summaryStoreDTO `json:"stores"`
	Rows             []summaryRowDTO   `json:"rows"`
	StoreTotalsCents []int64           `json:"store_totals_cents"`
	GrandTotalCents  int64             `json:"grand_total_cents"`
}

type reportSettingsDTO struct {
	OrganisationID     int64  `json:"organisation_id"`
	OrganisationName   string `json:"organisation_name"`
	Archived           bool   `json:"archived"`
	CalculationEnabled bool   `json:"calculation_enabled"`
	ReportsCount       int    `json:"reports_count"`
}

// api holds the platform services the handlers use (core.Services is all the module gets from the shell).
type api struct{ core.Services }

func (a *api) orgOr404(ctx context.Context, q core.Querier, id int64) (*core.Org, error) {
	o, err := a.Organisation(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, core.HTTPError{Status: 404, Detail: "Підрозділ не знайдено."}
	}
	return o, nil
}

type mutationDTO struct {
	ID       int64  `json:"id"`
	Archived bool   `json:"archived"`
	Deleted  bool   `json:"deleted"`
	Message  string `json:"message"`
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (a *api) currentPeriod() string { return a.Now().In(time.Local).Format("2006-01") }

// routes lists the module's endpoints; the shell registers each behind its permission check.
func routes(s core.Services) []core.Route {
	a := &api{s}
	cm := []string{CatalogManage}
	rv := []string{Review}
	sm := []string{SettingsManage}
	sub := []string{Submit}
	return []core.Route{
		{Method: "GET", Path: "/admin/products", Codes: cm, Handler: a.listProducts},
		{Method: "POST", Path: "/admin/products", Codes: cm, Handler: a.createProduct},
		{Method: "PUT", Path: "/admin/products/{pid}/price", Codes: cm, Handler: a.updateProductPrice},
		{Method: "PUT", Path: "/admin/products/{pid}", Codes: cm, Handler: a.updateProduct},
		{Method: "DELETE", Path: "/admin/products/{pid}", Codes: cm, Handler: a.deleteProduct},
		{Method: "POST", Path: "/admin/products/{pid}/restore", Codes: cm, Handler: a.restoreProduct},
		{Method: "POST", Path: "/admin/products/import", Codes: cm, Handler: a.importProducts},

		{Method: "GET", Path: "/store/reports/{period}", Codes: sub, Member: true, Handler: a.readStoreReport},
		{Method: "PUT", Path: "/store/reports/{period}", Codes: sub, Member: true, Handler: a.saveStoreReport},
		{Method: "GET", Path: "/store/reports/{period}/days", Codes: sub, Member: true, Handler: a.readStoreDays},
		{Method: "GET", Path: "/store/reports/{period}/days/{day}", Codes: sub, Member: true, Handler: a.readStoreDay},
		{Method: "PUT", Path: "/store/reports/{period}/days/{day}", Codes: sub, Member: true, Handler: a.saveStoreDay},

		{Method: "GET", Path: "/admin/reports", Codes: rv, Handler: a.listAdminReports},
		{Method: "GET", Path: "/admin/reports/{rid}", Codes: rv, Handler: a.readAdminReport},
		{Method: "PATCH", Path: "/admin/reports/{rid}", Codes: rv, Handler: a.updateAdminReportStatus},
		{Method: "GET", Path: "/admin/reports/{rid}/days", Codes: rv, Handler: a.readAdminDays},
		{Method: "GET", Path: "/admin/reports/{rid}/days/{day}", Codes: rv, Handler: a.readAdminDay},
		{Method: "PATCH", Path: "/admin/reports/{rid}/days/{day}", Codes: rv, Handler: a.updateAdminDayStatus},
		{Method: "GET", Path: "/admin/daily-reports", Codes: rv, Handler: a.listDailyReports},
		{Method: "GET", Path: "/admin/summary", Codes: rv, Handler: a.readSummary},
		{Method: "GET", Path: "/admin/summary.xlsx", Codes: rv, Handler: a.exportSummary},

		{Method: "GET", Path: "/reports/settings", Codes: sm, Handler: a.listReportSettings},
		{Method: "PUT", Path: "/reports/settings/{oid}", Codes: sm, Handler: a.updateReportSettings},
	}
}

// --- products ------------------------------------------------------------------------

func (a *api) productDTO(p Product, used int, period string, history map[int64]History) productDTO {
	h := HistoryOf(history, p)
	d := productDTO{ID: p.ID, Name: p.Name, PriceCents: p.PriceCents, Active: p.Active, Archived: p.Archived,
		UsedCount: used, MonthPricesCents: MonthPriceTimeline(h, period), PriceHistory: []pricePointDTO{}}
	for _, pt := range h {
		d.PriceHistory = append(d.PriceHistory, pricePointDTO{pt.Period, pt.Cents})
	}
	return d
}

func (a *api) oneProductDTO(ctx context.Context, q core.Querier, id int64, withUsage bool) (productDTO, error) {
	p, err := LoadProduct(ctx, q, id)
	if err != nil || p == nil {
		return productDTO{}, err
	}
	history, err := LoadHistory(ctx, q)
	if err != nil {
		return productDTO{}, err
	}
	used := 0
	if withUsage {
		u, err := ProductUsage(ctx, q)
		if err != nil {
			return productDTO{}, err
		}
		used = u[id]
	}
	return a.productDTO(*p, used, a.currentPeriod(), history), nil
}

func (a *api) listProducts(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	period, err := a.parsePeriod(core.Query(r).String("period"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	used, err := ProductUsage(ctx, a.Read)
	if err != nil {
		return err
	}
	history, err := LoadHistory(ctx, a.Read)
	if err != nil {
		return err
	}
	products, err := LoadProducts(ctx, a.Read, "")
	if err != nil {
		return err
	}
	out := make([]productDTO, 0, len(products))
	for _, pr := range products {
		out = append(out, a.productDTO(pr, used[pr.ID], period, history))
	}
	core.WriteJSON(w, http.StatusOK, out)
	return nil
}

func formErr(err error) error {
	if err == ErrBadPrice {
		return core.FormError{Message: err.Error()}
	}
	return err
}

func (a *api) createProduct(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	rawName := body.String("name", 1, 100)
	rawPrice := body.String("price", 1, 30)
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	var id int64
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		name, err := core.CleanName(rawName, "Назва")
		if err != nil {
			return err
		}
		cents, err := ToCents(rawPrice)
		if err != nil {
			return formErr(err)
		}
		res, err := tx.ExecContext(r.Context(), "INSERT INTO products (name, price_cents, active, archived) VALUES (?, ?, 1, 0)", name, cents)
		if err != nil {
			return err
		}
		id, _ = res.LastInsertId()
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO product_prices (product_id, period, price_cents) VALUES (?, ?, ?)", id, BasePeriod, cents); err != nil {
			return err
		}
		return a.Audit(tx, ip, p, "додано товар", name+" · "+FormatMoney(cents))
	})
	if err != nil {
		return err
	}
	d, err := a.oneProductDTO(r.Context(), a.Read, id, false)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusCreated, d)
	return nil
}

// changePrice applies a price change for the current month inside the caller's transaction.
func (a *api) changePrice(ctx context.Context, tx *sql.Tx, pr *Product, cents int64, ip string, p *core.Caller) error {
	period := a.currentPeriod()
	all, err := LoadHistory(ctx, tx)
	if err != nil {
		return err
	}
	hist := HistoryOf(all, *pr)
	nh, prev, now, err := ApplyPriceChange(hist, period, cents)
	if err != nil {
		return err
	}
	if !samePricePoints(nh, hist) {
		if err := SaveHistory(ctx, tx, pr.ID, nh); err != nil {
			return err
		}
		latest, err := LatestPrice(nh)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE products SET price_cents = ? WHERE id = ?", latest, pr.ID); err != nil {
			return err
		}
		return a.Audit(tx, ip, p, "змінено ціну товару",
			pr.Name+" · "+FormatMoney(prev)+" → "+FormatMoney(now)+" з "+period)
	}
	return nil
}

func samePricePoints(a, b History) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func productOr404(ctx context.Context, q core.Querier, id int64, allowArchived bool) (*Product, error) {
	pr, err := LoadProduct(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if pr == nil || (pr.Archived && !allowArchived) {
		return nil, core.HTTPError{Status: 404, Detail: "Товар не знайдено."}
	}
	return pr, nil
}

// pyString renders a JSON value like Python's str(payload.get(key) or ""): falsy values give "".
func pyString(raw json.RawMessage) string {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case float64:
		if t == 0 {
			return ""
		}
		b, _ := json.Marshal(t)
		return string(b)
	case bool:
		if t {
			return "True"
		}
	}
	return ""
}

func (a *api) updateProductPrice(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	pid := pm.PathInt("pid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	ip := a.ClientIP(r)
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		pr, err := productOr404(r.Context(), tx, pid, false)
		if err != nil {
			return err
		}
		raw := strings.TrimSpace(pyString(body.Raw("price")))
		if raw == "" {
			return core.HTTPError{Status: 400, Detail: "Вкажіть нову ціну."}
		}
		cents, err := ToCents(raw)
		if err != nil {
			return formErr(err)
		}
		return a.changePrice(r.Context(), tx, pr, cents, ip, p)
	})
	if err != nil {
		return err
	}
	d, err := a.oneProductDTO(r.Context(), a.Read, pid, true)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, d)
	return nil
}

func (a *api) updateProduct(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	pid := pm.PathInt("pid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	rawName := body.String("name", 1, 100)
	rawPrice := body.String("price", 1, 30)
	active := body.Bool("active")
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		pr, err := productOr404(ctx, tx, pid, false)
		if err != nil {
			return err
		}
		name, err := core.CleanName(rawName, "Назва")
		if err != nil {
			return err
		}
		cents, err := ToCents(rawPrice)
		if err != nil {
			return formErr(err)
		}
		if err := a.changePrice(ctx, tx, pr, cents, ip, p); err != nil {
			return err
		}
		var changed []string
		if pr.Name != name {
			changed = append(changed, "назва «"+pr.Name+"» → «"+name+"»")
		}
		if pr.Active != active {
			if active {
				changed = append(changed, "увімкнено")
			} else {
				changed = append(changed, "вимкнено")
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE products SET name = ?, active = ? WHERE id = ?", name, boolInt(active), pid); err != nil {
			return err
		}
		if len(changed) > 0 {
			return a.Audit(tx, ip, p, "змінено товар", name+" · "+strings.Join(changed, "; "))
		}
		return nil
	})
	if err != nil {
		return err
	}
	d, err := a.oneProductDTO(r.Context(), a.Read, pid, true)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, d)
	return nil
}

func (a *api) deleteProduct(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	pid := pm.PathInt("pid")
	if err := pm.Err(); err != nil {
		return err
	}
	ctx := r.Context()
	ip := a.ClientIP(r)
	if _, err := productOr404(ctx, a.Read, pid, true); err != nil {
		return err
	}
	usage, err := ProductUsage(ctx, a.Read)
	if err != nil {
		return err
	}
	if usage[pid] == 0 { // snapshot before a permanent delete, outside the writer
		if err := a.Snapshot("before-delete"); err != nil {
			return err
		}
	}
	var out mutationDTO
	err = a.Write(ctx, func(tx *sql.Tx) error {
		pr, err := productOr404(ctx, tx, pid, true)
		if err != nil {
			return err
		}
		usage, err := ProductUsage(ctx, tx)
		if err != nil {
			return err
		}
		if used := usage[pid]; used > 0 {
			if _, err := tx.ExecContext(ctx, "UPDATE products SET archived = 1, active = 0 WHERE id = ?", pid); err != nil {
				return err
			}
			if err := a.Audit(tx, ip, p, "архівовано товар", pr.Name+" · рядків у звітах: "+strconv.Itoa(used)); err != nil {
				return err
			}
			out = mutationDTO{ID: pid, Archived: true, Message: "«" + pr.Name + "» переміщено в архів. Дані звітів збережено."}
			return nil
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM product_prices WHERE product_id = ?", pid); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM products WHERE id = ?", pid); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "видалено товар", pr.Name); err != nil {
			return err
		}
		out = mutationDTO{ID: pid, Deleted: true, Message: "Товар «" + pr.Name + "» остаточно видалено."}
		return nil
	})
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (a *api) restoreProduct(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	pid := pm.PathInt("pid")
	if err := pm.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	err := a.Write(r.Context(), func(tx *sql.Tx) error {
		pr, err := productOr404(r.Context(), tx, pid, true)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), "UPDATE products SET archived = 0, active = 1 WHERE id = ?", pid); err != nil {
			return err
		}
		return a.Audit(tx, ip, p, "відновлено товар", pr.Name)
	})
	if err != nil {
		return err
	}
	d, err := a.oneProductDTO(r.Context(), a.Read, pid, true)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, d)
	return nil
}

// --- report line DTOs -------------------------------------------------------------------

func lineDTOs(rows []LineRow) []reportLineDTO {
	out := make([]reportLineDTO, 0, len(rows))
	for _, row := range rows {
		d := reportLineDTO{ID: row.ID, Name: row.Name, Repriced: row.Repriced, SumCents: row.Sum, Inputs: []reportInputDTO{}}
		for _, in := range row.Inputs {
			d.Inputs = append(d.Inputs, reportInputDTO{in.Price, in.Qty, in.QtyCalc, in.Label, in.Qty * in.Price})
		}
		out = append(out, d)
	}
	return out
}

func inactiveDTOs(rows []InactiveRow) []inactiveLineDTO {
	out := make([]inactiveLineDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, inactiveLineDTO{r.Name, r.Archived, r.Lines, r.Sum})
	}
	return out
}

// --- store: monthly report ----------------------------------------------------------------

func (a *api) storeReportDTO(ctx context.Context, q core.Querier, p *core.Caller, period string, rep *Report) (storeReportDTO, error) {
	orgID := p.Org.ID
	enabled, err := CalculationEnabled(ctx, q, orgID)
	if err != nil {
		return storeReportDTO{}, err
	}
	var items []Item
	if rep != nil {
		if items, err = LoadItems(ctx, q, rep.ID); err != nil {
			return storeReportDTO{}, err
		}
	}
	rows, inactive, inactiveTotal, err := BuildLines(ctx, q, period, items, enabled)
	if err != nil {
		return storeReportDTO{}, err
	}
	known, err := StorePeriods(ctx, q, orgID)
	if err != nil {
		return storeReportDTO{}, err
	}
	known[a.currentPeriod()] = true
	periods := make([]string, 0, len(known))
	for k := range known {
		periods = append(periods, k)
	}
	sort.Strings(periods)
	d := storeReportDTO{StoreName: p.Org.Name, Period: period, Status: "new", CalculationEnabled: enabled,
		Rows: lineDTOs(rows), InactiveRows: inactiveDTOs(inactive), InactiveTotalCents: inactiveTotal, AvailablePeriods: periods}
	for _, r := range rows {
		d.TotalCents += r.Sum
	}
	if rep != nil {
		sigs, err := SignaturesOf(ctx, q, rep.ID)
		if err != nil {
			return storeReportDTO{}, err
		}
		d.signedDTO = signedOf(rep.Status, sigs)
	}
	d.TotalCents += inactiveTotal
	if rep != nil {
		id := rep.ID
		daily, err := IsDaily(ctx, q, rep.ID)
		if err != nil {
			return storeReportDTO{}, err
		}
		// A month kept by days is changed day by day (the month view is their sum).
		d.ReportID, d.Status, d.ReadOnly = &id, rep.Status, rep.Status == "submitted" || daily
	}
	return d, nil
}

func (a *api) readStoreReport(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	selected, err := a.parsePeriod(core.Param(r, "period"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	known, err := StorePeriods(ctx, a.Read, p.Org.ID)
	if err != nil {
		return err
	}
	if selected != a.currentPeriod() && !known[selected] {
		return core.HTTPError{Status: 404, Detail: "Звіту за " + selected + " немає."}
	}
	rep, err := FindReport(ctx, a.Read, p.Org.ID, selected)
	if err != nil {
		return err
	}
	d, err := a.storeReportDTO(ctx, a.Read, p, selected, rep)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, d)
	return nil
}

type saveLine struct {
	product, price, qty int64
	calc                *int64
}

func (a *api) saveStoreReport(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	selected, err := a.parsePeriod(core.Param(r, "period"))
	if err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	action := body.OptLiteral("action", "draft", "draft", "submit")
	var lines []saveLine
	for _, item := range body.ObjectList("quantities", 5000) {
		lines = append(lines, saveLine{
			product: item.Int("product_id", 0, true),
			price:   item.Int("price_cents", 0, false),
			qty:     item.Int("quantity", 0, false),
			calc:    item.OptIntMin("quantity_calc", 0),
		})
	}
	if err := body.Err(); err != nil {
		return err
	}
	orgID, ip := p.Org.ID, a.ClientIP(r)
	var dto storeReportDTO
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		known, err := StorePeriods(ctx, tx, orgID)
		if err != nil {
			return err
		}
		if selected != a.currentPeriod() && !known[selected] {
			return core.HTTPError{Status: 403, Detail: "Звіту за " + selected + " не існує."}
		}
		rep, err := FindReport(ctx, tx, orgID, selected)
		if err != nil {
			return err
		}
		if rep != nil && rep.Status == "submitted" {
			return core.HTTPError{Status: 409, Detail: "Звіт надіслано й заблоковано адміністратором."}
		}
		if rep != nil {
			if daily, err := IsDaily(ctx, tx, rep.ID); err != nil {
				return err
			} else if daily {
				return core.HTTPError{Status: 409, Detail: errDailyMonth}
			}
		}
		if rep == nil {
			res, err := tx.ExecContext(ctx, "INSERT INTO reports (store_id, period, status) VALUES (?, ?, 'draft')", orgID, selected)
			if err != nil {
				return err
			}
			id, _ := res.LastInsertId()
			rep = &Report{ID: id, StoreID: orgID, Period: selected, Status: "draft"}
		}
		items, err := LoadItems(ctx, tx, rep.ID)
		if err != nil {
			return err
		}
		editable, quantities, err := checkedQuantities(ctx, tx, selected, items, lines)
		if err != nil {
			return err
		}
		// Rows of inactive/archived products are read-only in the UI and stay untouched.
		if err := ReplaceEditableItems(ctx, tx, rep.ID, editable, items, quantities); err != nil {
			return err
		}
		status, auditAction := "draft", "збережено звіт"
		if action == "submit" {
			status, auditAction = "submitted", "надіслано звіт"
		}
		if _, err := tx.ExecContext(ctx, "UPDATE reports SET status = ? WHERE id = ?", status, rep.ID); err != nil {
			return err
		}
		if action == "submit" { // the store employee's signature
			if err := RecordSignature(ctx, tx, rep.ID, p.ID, p.DisplayName(), KindStore, a.Now()); err != nil {
				return err
			}
		}
		if err := a.Audit(tx, ip, p, auditAction, p.Org.Name+" · "+selected); err != nil {
			return err
		}
		if action == "submit" {
			if err := a.NotifyHolders(ctx, tx, p.ID, 0, []string{Review}, "report.submitted", "Звіт надіслано",
				core.JoinNames(p.Org.Name, selected), "/admin/reports/"+strconv.Itoa(int(rep.ID))); err != nil {
				return err
			}
		}
		rep.Status = status
		dto, err = a.storeReportDTO(ctx, tx, p, selected, rep)
		return err
	})
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, dto)
	return nil
}

// checkedQuantities validates the posted lines against the products a store can edit and the prices offered for
// the period (plus prices already saved in items with a quantity), and returns the editable products and the new
// quantities ({product: {price: (qty, calc)}}). A line without quantity_calc keeps the saved one.
func checkedQuantities(ctx context.Context, tx *sql.Tx, period string, items []Item, lines []saveLine) (map[int64]bool, map[int64]map[int64][2]int64, error) {
	history, err := LoadHistory(ctx, tx)
	if err != nil {
		return nil, nil, err
	}
	active, err := LoadProducts(ctx, tx, "WHERE active != 0 AND archived = 0")
	if err != nil {
		return nil, nil, err
	}
	allowed := map[int64]map[int64]bool{}
	editable := map[int64]bool{}
	for _, pr := range active {
		set := map[int64]bool{}
		for _, c := range OfferedPrices(HistoryOf(history, pr), period) {
			set[c] = true
		}
		allowed[pr.ID], editable[pr.ID] = set, true
	}
	existingCalc := map[[2]int64]int64{}
	for _, it := range items {
		if set, ok := allowed[it.ProductID]; ok && (it.Quantity > 0 || it.QuantityCalc > 0) {
			set[it.UnitPrice] = true
		}
		existingCalc[[2]int64{it.ProductID, it.UnitPrice}] += it.QuantityCalc
	}
	seen := map[[2]int64]bool{}
	quantities := map[int64]map[int64][2]int64{}
	for _, l := range lines {
		key := [2]int64{l.product, l.price}
		if seen[key] {
			return nil, nil, core.HTTPError{Status: 422, Detail: "Повторюється рядок товару/ціни."}
		}
		seen[key] = true
		calc := existingCalc[key]
		if l.calc != nil {
			calc = *l.calc
		}
		if l.qty == 0 && calc == 0 {
			continue
		}
		if !allowed[l.product][l.price] {
			return nil, nil, core.HTTPError{Status: 409, Detail: "Список товарів або ціни змінилися. Оновіть звіт і повторіть збереження."}
		}
		if quantities[l.product] == nil {
			quantities[l.product] = map[int64][2]int64{}
		}
		quantities[l.product][l.price] = [2]int64{l.qty, calc}
	}
	return editable, quantities, nil
}

// --- review ------------------------------------------------------------------------------

func (a *api) listAdminReports(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	selected, err := a.parsePeriod(core.Query(r).String("period"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	type rep struct {
		id     int64
		status string
		total  int64
		count  int
	}
	byStore := map[int64]rep{}
	rows, err := a.Read.QueryContext(ctx, `SELECT r.store_id, r.id, r.status, COALESCE(SUM(i.quantity * i.unit_price_cents), 0), COUNT(i.id)
		FROM reports r LEFT JOIN report_items i ON i.report_id = r.id WHERE r.period = ? GROUP BY r.id`, selected)
	if err != nil {
		return err
	}
	for rows.Next() {
		var sid int64
		var x rep
		if err := rows.Scan(&sid, &x.id, &x.status, &x.total, &x.count); err != nil {
			rows.Close()
			return err
		}
		byStore[sid] = x
	}
	rows.Close()
	subs, err := SignaturesForPeriod(ctx, a.Read, selected)
	if err != nil {
		return err
	}
	dayCounts := map[int64][2]int{}
	drows, err := a.Read.QueryContext(ctx, `SELECT d.report_id, COUNT(*), COALESCE(SUM(d.status = 'submitted'), 0)
		FROM report_days d JOIN reports r ON r.id = d.report_id WHERE r.period = ? GROUP BY d.report_id`, selected)
	if err != nil {
		return err
	}
	for drows.Next() {
		var id int64
		var n, sub int
		if err := drows.Scan(&id, &n, &sub); err != nil {
			drows.Close()
			return err
		}
		dayCounts[id] = [2]int{n, sub}
	}
	drows.Close()
	orgs, err := a.Read.QueryContext(ctx, "SELECT id, name, archived FROM organisations ORDER BY name")
	if err != nil {
		return err
	}
	defer orgs.Close()
	out := []adminReportListItemDTO{}
	for orgs.Next() {
		var id int64
		var name string
		var arch int
		if err := orgs.Scan(&id, &name, &arch); err != nil {
			return err
		}
		x, has := byStore[id]
		if arch != 0 && !has {
			continue
		}
		d := adminReportListItemDTO{StoreID: id, StoreName: name, StoreArchived: arch != 0, Period: selected, Status: "none"}
		if has {
			rid := x.id
			d.ReportID, d.Status, d.TotalCents, d.ItemCount = &rid, x.status, x.total, x.count
			if sigs, ok := subs[rid]; ok {
				d.signedDTO = signedOf(x.status, sigs)
			}
			if c, ok := dayCounts[rid]; ok {
				d.DaysCount, d.DaysSubmitted = c[0], c[1]
			}
		}
		out = append(out, d)
	}
	core.WriteJSON(w, http.StatusOK, out)
	return orgs.Err()
}

func (a *api) adminReportHeader(ctx context.Context, q core.Querier, rep *Report) (adminReportDTO, []Item, error) {
	items, err := LoadItems(ctx, q, rep.ID)
	if err != nil {
		return adminReportDTO{}, nil, err
	}
	org, err := a.Organisation(ctx, q, rep.StoreID)
	if err != nil {
		return adminReportDTO{}, nil, err
	}
	enabled, err := CalculationEnabled(ctx, q, rep.StoreID)
	if err != nil {
		return adminReportDTO{}, nil, err
	}
	d := adminReportDTO{ReportID: rep.ID, StoreID: rep.StoreID, StoreName: "?", CalculationEnabled: enabled,
		Period: rep.Period, Status: rep.Status, TotalCents: ReportTotal(items), ItemCount: len(items)}
	if org != nil {
		d.StoreName, d.StoreArchived = org.Name, org.Archived
	}
	sigs, err := SignaturesOf(ctx, q, rep.ID)
	if err != nil {
		return adminReportDTO{}, nil, err
	}
	d.signedDTO = signedOf(rep.Status, sigs)
	return d, items, nil
}

func reportOr404(ctx context.Context, q core.Querier, id int64) (*Report, error) {
	rep, err := GetReport(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if rep == nil {
		return nil, core.HTTPError{Status: 404, Detail: "Звіт не знайдено."}
	}
	return rep, nil
}

func (a *api) readAdminReport(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	rid := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	ctx := r.Context()
	rep, err := reportOr404(ctx, a.Read, rid)
	if err != nil {
		return err
	}
	head, items, err := a.adminReportHeader(ctx, a.Read, rep)
	if err != nil {
		return err
	}
	rows, inactive, total, err := BuildLines(ctx, a.Read, rep.Period, items, head.CalculationEnabled)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, adminReportDetailDTO{head, lineDTOs(rows), inactiveDTOs(inactive), total})
	return nil
}

func (a *api) updateAdminReportStatus(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	rid := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	target := body.Literal("status", "draft", "submitted")
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	var head adminReportDTO
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		rep, err := reportOr404(ctx, tx, rid)
		if err != nil {
			return err
		}
		// A month kept by days is locked or unlocked day by day: every day takes the new status.
		if err := a.setAllDays(ctx, tx, rep, target, p); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE reports SET status = ? WHERE id = ?", target, rid); err != nil {
			return err
		}
		was := rep.Status
		rep.Status = target
		// An administrator's lock is recorded as such (it is not a store's submission) and never replaces the
		// employee's signature; locking a report that is already submitted changes nothing.
		if target == "submitted" && was != "submitted" {
			if err := RecordSignature(ctx, tx, rep.ID, p.ID, p.DisplayName(), KindAdmin, a.Now()); err != nil {
				return err
			}
		}
		if head, _, err = a.adminReportHeader(ctx, tx, rep); err != nil {
			return err
		}
		action := "розблоковано звіт"
		if target == "submitted" {
			action = "заблоковано звіт"
		}
		return a.Audit(tx, ip, p, action, head.StoreName+" · "+rep.Period)
	})
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, head)
	return nil
}

func (a *api) readSummary(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	submittedOnly := pm.Bool("submitted_only", false)
	if err := pm.Err(); err != nil {
		return err
	}
	selected, day, err := a.summaryScope(pm.String("period"), pm.String("day"))
	if err != nil {
		return err
	}
	s, err := BuildSummaryFor(r.Context(), a.Read, selected, day, submittedOnly)
	if err != nil {
		return err
	}
	d := summaryDTO{Period: selected, Day: day, SubmittedOnly: submittedOnly, Stores: []summaryStoreDTO{}, Rows: []summaryRowDTO{},
		StoreTotalsCents: s.StoreTotals, GrandTotalCents: s.Grand}
	for _, st := range s.Stores {
		d.Stores = append(d.Stores, summaryStoreDTO{st.ID, st.Name, st.Archived, st.CalculationEnabled})
	}
	for _, row := range s.Rows {
		d.Rows = append(d.Rows, summaryRowDTO{row.Name, row.Note, row.Price, row.Label, row.Cells, row.CalculationCells, row.Qty, row.CalcQty, row.Sum})
	}
	core.WriteJSON(w, http.StatusOK, d)
	return nil
}

// --- per-organisation settings ---------------------------------------------------------------

func (a *api) settingsDTOs(ctx context.Context, q core.Querier, only *int64) ([]reportSettingsDTO, error) {
	enabled, err := CalculationEnabledIDs(ctx, q)
	if err != nil {
		return nil, err
	}
	counts, err := UsagePerOrganisation(ctx, q)
	if err != nil {
		return nil, err
	}
	rows, err := q.QueryContext(ctx, "SELECT id, name, archived FROM organisations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []reportSettingsDTO{}
	for rows.Next() {
		var d reportSettingsDTO
		var arch int
		if err := rows.Scan(&d.OrganisationID, &d.OrganisationName, &arch); err != nil {
			return nil, err
		}
		if only != nil && d.OrganisationID != *only {
			continue
		}
		d.Archived, d.CalculationEnabled, d.ReportsCount = arch != 0, enabled[d.OrganisationID], counts[d.OrganisationID]
		out = append(out, d)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return strings.ToLower(out[i].OrganisationName) < strings.ToLower(out[j].OrganisationName)
	})
	return out, rows.Err()
}

func (a *api) listReportSettings(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	l, err := a.settingsDTOs(r.Context(), a.Read, nil)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, l)
	return nil
}

func (a *api) updateReportSettings(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	oid := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	enable := body.Bool("calculation_enabled")
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		org, err := a.orgOr404(ctx, tx, oid)
		if err != nil {
			return err
		}
		cur, err := CalculationEnabled(ctx, tx, oid)
		if err != nil {
			return err
		}
		if cur == enable {
			return nil
		}
		if err := SetCalculationEnabled(ctx, tx, oid, enable); err != nil {
			return err
		}
		state := "вимкнено"
		if enable {
			state = "увімкнено"
		}
		return a.Audit(tx, ip, p, "змінено налаштування звітів",
			org.Name+": режим «По розрахунку» "+state)
	})
	if err != nil {
		return err
	}
	l, err := a.settingsDTOs(r.Context(), a.Read, &oid)
	if err != nil || len(l) == 0 {
		return err
	}
	core.WriteJSON(w, http.StatusOK, l[0])
	return nil
}
