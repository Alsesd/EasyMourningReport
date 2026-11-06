package web

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"legkyi/internal/core"
	"legkyi/internal/platform"
	"legkyi/internal/reports"
)

var periodRE = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

// parsePeriod: empty means the current local month; otherwise YYYY-MM or a 400.
func (a *App) parsePeriod(p string) (string, error) {
	if p == "" {
		p = a.currentPeriod()
	}
	if !periodRE.MatchString(p) {
		return "", HTTPError{Status: 400, Detail: "Період має мати вигляд 2026-10"}
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

func signedOf(status string, s reports.Signatures) signedDTO {
	var d signedDTO
	conv := func(x *reports.Signature) *signatureDTO {
		if x == nil {
			return nil
		}
		return &signatureDTO{By: x.ByName, At: servedTimeOf(x.At)}
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

func (a *App) mountReports(rt *Router) {
	cm := []string{reports.CatalogManage}
	rt.Handle("GET", "/admin/products", a.authed(cm, a.listProducts))
	rt.Handle("POST", "/admin/products", a.authed(cm, a.createProduct))
	rt.Handle("PUT", "/admin/products/{pid}/price", a.authed(cm, a.updateProductPrice))
	rt.Handle("PUT", "/admin/products/{pid}", a.authed(cm, a.updateProduct))
	rt.Handle("DELETE", "/admin/products/{pid}", a.authed(cm, a.deleteProduct))
	rt.Handle("POST", "/admin/products/{pid}/restore", a.authed(cm, a.restoreProduct))
	rt.Handle("POST", "/admin/products/import", a.authed(cm, a.importProducts))

	rt.Handle("GET", "/store/reports/{period}", a.member([]string{reports.Submit}, a.readStoreReport))
	rt.Handle("PUT", "/store/reports/{period}", a.member([]string{reports.Submit}, a.saveStoreReport))

	rv := []string{reports.Review}
	rt.Handle("GET", "/admin/reports", a.authed(rv, a.listAdminReports))
	rt.Handle("GET", "/admin/reports/{rid}", a.authed(rv, a.readAdminReport))
	rt.Handle("PATCH", "/admin/reports/{rid}", a.authed(rv, a.updateAdminReportStatus))
	rt.Handle("GET", "/admin/summary", a.authed(rv, a.readSummary))
	rt.Handle("GET", "/admin/summary.xlsx", a.authed(rv, a.exportSummary))

	sm := []string{reports.SettingsManage}
	rt.Handle("GET", "/reports/settings", a.authed(sm, a.listReportSettings))
	rt.Handle("PUT", "/reports/settings/{oid}", a.authed(sm, a.updateReportSettings))

}

// --- products ------------------------------------------------------------------------

func (a *App) productDTO(p reports.Product, used int, period string, history map[int64]reports.History) productDTO {
	h := reports.HistoryOf(history, p)
	d := productDTO{ID: p.ID, Name: p.Name, PriceCents: p.PriceCents, Active: p.Active, Archived: p.Archived,
		UsedCount: used, MonthPricesCents: reports.MonthPriceTimeline(h, period), PriceHistory: []pricePointDTO{}}
	for _, pt := range h {
		d.PriceHistory = append(d.PriceHistory, pricePointDTO{pt.Period, pt.Cents})
	}
	return d
}

func (a *App) oneProductDTO(ctx context.Context, q core.Querier, id int64, withUsage bool) (productDTO, error) {
	p, err := reports.LoadProduct(ctx, q, id)
	if err != nil || p == nil {
		return productDTO{}, err
	}
	history, err := reports.LoadHistory(ctx, q)
	if err != nil {
		return productDTO{}, err
	}
	used := 0
	if withUsage {
		u, err := reports.ProductUsage(ctx, q)
		if err != nil {
			return productDTO{}, err
		}
		used = u[id]
	}
	return a.productDTO(*p, used, a.currentPeriod(), history), nil
}

func (a *App) listProducts(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	period, err := a.parsePeriod(Query(r).String("period"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	used, err := reports.ProductUsage(ctx, a.Store.R)
	if err != nil {
		return err
	}
	history, err := reports.LoadHistory(ctx, a.Store.R)
	if err != nil {
		return err
	}
	products, err := reports.LoadProducts(ctx, a.Store.R, "")
	if err != nil {
		return err
	}
	out := make([]productDTO, 0, len(products))
	for _, pr := range products {
		out = append(out, a.productDTO(pr, used[pr.ID], period, history))
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func formErr(err error) error {
	if err == reports.ErrBadPrice {
		return FormError{err.Error()}
	}
	return err
}

func (a *App) createProduct(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	rawName := body.String("name", 1, 100)
	rawPrice := body.String("price", 1, 30)
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	var id int64
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		name, err := platform.CleanName(rawName, "Назва")
		if err != nil {
			return err
		}
		cents, err := reports.ToCents(rawPrice)
		if err != nil {
			return formErr(err)
		}
		res, err := tx.ExecContext(r.Context(), "INSERT INTO products (name, price_cents, active, archived) VALUES (?, ?, 1, 0)", name, cents)
		if err != nil {
			return err
		}
		id, _ = res.LastInsertId()
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO product_prices (product_id, period, price_cents) VALUES (?, ?, ?)", id, reports.BasePeriod, cents); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "додано товар", name+" · "+reports.FormatMoney(cents))
	})
	if err != nil {
		return err
	}
	d, err := a.oneProductDTO(r.Context(), a.Store.R, id, false)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, d)
	return nil
}

// changePrice applies a price change for the current month inside the caller's transaction.
func (a *App) changePrice(ctx context.Context, tx *sql.Tx, pr *reports.Product, cents int64, ip string, p *platform.Principal) error {
	period := a.currentPeriod()
	all, err := reports.LoadHistory(ctx, tx)
	if err != nil {
		return err
	}
	hist := reports.HistoryOf(all, *pr)
	nh, prev, now, err := reports.ApplyPriceChange(hist, period, cents)
	if err != nil {
		return err
	}
	if !samePricePoints(nh, hist) {
		if err := reports.SaveHistory(ctx, tx, pr.ID, nh); err != nil {
			return err
		}
		latest, err := reports.LatestPrice(nh)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE products SET price_cents = ? WHERE id = ?", latest, pr.ID); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено ціну товару",
			pr.Name+" · "+reports.FormatMoney(prev)+" → "+reports.FormatMoney(now)+" з "+period)
	}
	return nil
}

func samePricePoints(a, b reports.History) bool {
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

func productOr404(ctx context.Context, q core.Querier, id int64, allowArchived bool) (*reports.Product, error) {
	pr, err := reports.LoadProduct(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if pr == nil || (pr.Archived && !allowArchived) {
		return nil, HTTPError{Status: 404, Detail: "Товар не знайдено."}
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

func (a *App) updateProductPrice(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	pid := pm.PathInt("pid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		pr, err := productOr404(r.Context(), tx, pid, false)
		if err != nil {
			return err
		}
		raw := strings.TrimSpace(pyString(body.fields["price"]))
		if raw == "" {
			return HTTPError{Status: 400, Detail: "Вкажіть нову ціну."}
		}
		cents, err := reports.ToCents(raw)
		if err != nil {
			return formErr(err)
		}
		return a.changePrice(r.Context(), tx, pr, cents, ip, p)
	})
	if err != nil {
		return err
	}
	d, err := a.oneProductDTO(r.Context(), a.Store.R, pid, true)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

func (a *App) updateProduct(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	pid := pm.PathInt("pid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	rawName := body.String("name", 1, 100)
	rawPrice := body.String("price", 1, 30)
	active := body.Bool("active")
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		pr, err := productOr404(ctx, tx, pid, false)
		if err != nil {
			return err
		}
		name, err := platform.CleanName(rawName, "Назва")
		if err != nil {
			return err
		}
		cents, err := reports.ToCents(rawPrice)
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
			return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено товар", name+" · "+strings.Join(changed, "; "))
		}
		return nil
	})
	if err != nil {
		return err
	}
	d, err := a.oneProductDTO(r.Context(), a.Store.R, pid, true)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

func (a *App) deleteProduct(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	pid := pm.PathInt("pid")
	if err := pm.Err(); err != nil {
		return err
	}
	ctx := r.Context()
	ip := a.Trusted.ClientIP(r)
	if _, err := productOr404(ctx, a.Store.R, pid, true); err != nil {
		return err
	}
	usage, err := reports.ProductUsage(ctx, a.Store.R)
	if err != nil {
		return err
	}
	if usage[pid] == 0 && a.Backups != nil { // snapshot before a permanent delete, outside the writer
		if _, err := a.Backups.Run("before-delete"); err != nil {
			return err
		}
	}
	var out mutationDTO
	err = a.write(ctx, func(tx *sql.Tx) error {
		pr, err := productOr404(ctx, tx, pid, true)
		if err != nil {
			return err
		}
		usage, err := reports.ProductUsage(ctx, tx)
		if err != nil {
			return err
		}
		if used := usage[pid]; used > 0 {
			if _, err := tx.ExecContext(ctx, "UPDATE products SET archived = 1, active = 0 WHERE id = ?", pid); err != nil {
				return err
			}
			if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "архівовано товар", pr.Name+" · рядків у звітах: "+itoa(used)); err != nil {
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
		if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "видалено товар", pr.Name); err != nil {
			return err
		}
		out = mutationDTO{ID: pid, Deleted: true, Message: "Товар «" + pr.Name + "» остаточно видалено."}
		return nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) restoreProduct(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	pid := pm.PathInt("pid")
	if err := pm.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	err := a.write(r.Context(), func(tx *sql.Tx) error {
		pr, err := productOr404(r.Context(), tx, pid, true)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), "UPDATE products SET archived = 0, active = 1 WHERE id = ?", pid); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "відновлено товар", pr.Name)
	})
	if err != nil {
		return err
	}
	d, err := a.oneProductDTO(r.Context(), a.Store.R, pid, true)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

// --- report line DTOs -------------------------------------------------------------------

func lineDTOs(rows []reports.LineRow) []reportLineDTO {
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

func inactiveDTOs(rows []reports.InactiveRow) []inactiveLineDTO {
	out := make([]inactiveLineDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, inactiveLineDTO{r.Name, r.Archived, r.Lines, r.Sum})
	}
	return out
}

// --- store: monthly report ----------------------------------------------------------------

func (a *App) storeReportDTO(ctx context.Context, q core.Querier, p *platform.Principal, period string, rep *reports.Report) (storeReportDTO, error) {
	orgID := p.User.Org.ID
	enabled, err := reports.CalculationEnabled(ctx, q, orgID)
	if err != nil {
		return storeReportDTO{}, err
	}
	var items []reports.Item
	if rep != nil {
		if items, err = reports.LoadItems(ctx, q, rep.ID); err != nil {
			return storeReportDTO{}, err
		}
	}
	rows, inactive, inactiveTotal, err := reports.BuildLines(ctx, q, period, items, enabled)
	if err != nil {
		return storeReportDTO{}, err
	}
	known, err := reports.StorePeriods(ctx, q, orgID)
	if err != nil {
		return storeReportDTO{}, err
	}
	known[a.currentPeriod()] = true
	periods := make([]string, 0, len(known))
	for k := range known {
		periods = append(periods, k)
	}
	sort.Strings(periods)
	d := storeReportDTO{StoreName: p.User.Org.Name, Period: period, Status: "new", CalculationEnabled: enabled,
		Rows: lineDTOs(rows), InactiveRows: inactiveDTOs(inactive), InactiveTotalCents: inactiveTotal, AvailablePeriods: periods}
	for _, r := range rows {
		d.TotalCents += r.Sum
	}
	if rep != nil {
		sigs, err := reports.SignaturesOf(ctx, q, rep.ID)
		if err != nil {
			return storeReportDTO{}, err
		}
		d.signedDTO = signedOf(rep.Status, sigs)
	}
	d.TotalCents += inactiveTotal
	if rep != nil {
		id := rep.ID
		d.ReportID, d.Status, d.ReadOnly = &id, rep.Status, rep.Status == "submitted"
	}
	return d, nil
}

func (a *App) readStoreReport(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	selected, err := a.parsePeriod(Param(r, "period"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	known, err := reports.StorePeriods(ctx, a.Store.R, p.User.Org.ID)
	if err != nil {
		return err
	}
	if selected != a.currentPeriod() && !known[selected] {
		return HTTPError{Status: 404, Detail: "Звіту за " + selected + " немає."}
	}
	rep, err := reports.FindReport(ctx, a.Store.R, p.User.Org.ID, selected)
	if err != nil {
		return err
	}
	d, err := a.storeReportDTO(ctx, a.Store.R, p, selected, rep)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

type saveLine struct {
	product, price, qty int64
	calc                *int64
}

func (a *App) saveStoreReport(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	selected, err := a.parsePeriod(Param(r, "period"))
	if err != nil {
		return err
	}
	body, err := ReadBody(r)
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
	orgID, ip := p.User.Org.ID, a.Trusted.ClientIP(r)
	var dto storeReportDTO
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		known, err := reports.StorePeriods(ctx, tx, orgID)
		if err != nil {
			return err
		}
		if selected != a.currentPeriod() && !known[selected] {
			return HTTPError{Status: 403, Detail: "Звіту за " + selected + " не існує."}
		}
		rep, err := reports.FindReport(ctx, tx, orgID, selected)
		if err != nil {
			return err
		}
		if rep != nil && rep.Status == "submitted" {
			return HTTPError{Status: 409, Detail: "Звіт надіслано й заблоковано адміністратором."}
		}
		if rep == nil {
			res, err := tx.ExecContext(ctx, "INSERT INTO reports (store_id, period, status) VALUES (?, ?, 'draft')", orgID, selected)
			if err != nil {
				return err
			}
			id, _ := res.LastInsertId()
			rep = &reports.Report{ID: id, StoreID: orgID, Period: selected, Status: "draft"}
		}
		items, err := reports.LoadItems(ctx, tx, rep.ID)
		if err != nil {
			return err
		}
		history, err := reports.LoadHistory(ctx, tx)
		if err != nil {
			return err
		}
		active, err := reports.LoadProducts(ctx, tx, "WHERE active != 0 AND archived = 0")
		if err != nil {
			return err
		}
		allowed := map[int64]map[int64]bool{}
		editable := map[int64]bool{}
		for _, pr := range active {
			set := map[int64]bool{}
			for _, c := range reports.OfferedPrices(reports.HistoryOf(history, pr), selected) {
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
				return HTTPError{Status: 422, Detail: "Повторюється рядок товару/ціни."}
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
				return HTTPError{Status: 409, Detail: "Список товарів або ціни змінилися. Оновіть звіт і повторіть збереження."}
			}
			if quantities[l.product] == nil {
				quantities[l.product] = map[int64][2]int64{}
			}
			quantities[l.product][l.price] = [2]int64{l.qty, calc}
		}
		// Rows of inactive/archived products are read-only in the UI and stay untouched.
		if err := reports.ReplaceEditableItems(ctx, tx, rep.ID, editable, items, quantities); err != nil {
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
			if err := reports.RecordSignature(ctx, tx, rep.ID, p.User.ID, displayName(p.User), reports.KindStore, a.now()); err != nil {
				return err
			}
		}
		if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), auditAction, p.User.Org.Name+" · "+selected); err != nil {
			return err
		}
		rep.Status = status
		dto, err = a.storeReportDTO(ctx, tx, p, selected, rep)
		return err
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, dto)
	return nil
}

// --- review ------------------------------------------------------------------------------

func (a *App) listAdminReports(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	selected, err := a.parsePeriod(Query(r).String("period"))
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
	rows, err := a.Store.R.QueryContext(ctx, `SELECT r.store_id, r.id, r.status, COALESCE(SUM(i.quantity * i.unit_price_cents), 0), COUNT(i.id)
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
	subs, err := reports.SignaturesForPeriod(ctx, a.Store.R, selected)
	if err != nil {
		return err
	}
	orgs, err := a.Store.R.QueryContext(ctx, "SELECT id, name, archived FROM organisations ORDER BY name")
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
		}
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, out)
	return orgs.Err()
}

func (a *App) adminReportHeader(ctx context.Context, q core.Querier, rep *reports.Report) (adminReportDTO, []reports.Item, error) {
	items, err := reports.LoadItems(ctx, q, rep.ID)
	if err != nil {
		return adminReportDTO{}, nil, err
	}
	org, err := platform.LoadOrganisation(ctx, q, rep.StoreID)
	if err != nil {
		return adminReportDTO{}, nil, err
	}
	enabled, err := reports.CalculationEnabled(ctx, q, rep.StoreID)
	if err != nil {
		return adminReportDTO{}, nil, err
	}
	d := adminReportDTO{ReportID: rep.ID, StoreID: rep.StoreID, StoreName: "?", CalculationEnabled: enabled,
		Period: rep.Period, Status: rep.Status, TotalCents: reports.ReportTotal(items), ItemCount: len(items)}
	if org != nil {
		d.StoreName, d.StoreArchived = org.Name, org.Archived
	}
	sigs, err := reports.SignaturesOf(ctx, q, rep.ID)
	if err != nil {
		return adminReportDTO{}, nil, err
	}
	d.signedDTO = signedOf(rep.Status, sigs)
	return d, items, nil
}

func reportOr404(ctx context.Context, q core.Querier, id int64) (*reports.Report, error) {
	rep, err := reports.GetReport(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if rep == nil {
		return nil, HTTPError{Status: 404, Detail: "Звіт не знайдено."}
	}
	return rep, nil
}

func (a *App) readAdminReport(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	rid := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	ctx := r.Context()
	rep, err := reportOr404(ctx, a.Store.R, rid)
	if err != nil {
		return err
	}
	head, items, err := a.adminReportHeader(ctx, a.Store.R, rep)
	if err != nil {
		return err
	}
	rows, inactive, total, err := reports.BuildLines(ctx, a.Store.R, rep.Period, items, head.CalculationEnabled)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, adminReportDetailDTO{head, lineDTOs(rows), inactiveDTOs(inactive), total})
	return nil
}

func (a *App) updateAdminReportStatus(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	rid := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	target := body.Literal("status", "draft", "submitted")
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	var head adminReportDTO
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		rep, err := reportOr404(ctx, tx, rid)
		if err != nil {
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
			if err := reports.RecordSignature(ctx, tx, rep.ID, p.User.ID, displayName(p.User), reports.KindAdmin, a.now()); err != nil {
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
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), action, head.StoreName+" · "+rep.Period)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, head)
	return nil
}

func (a *App) readSummary(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	submittedOnly := pm.Bool("submitted_only", false)
	if err := pm.Err(); err != nil {
		return err
	}
	selected, err := a.parsePeriod(pm.String("period"))
	if err != nil {
		return err
	}
	s, err := reports.BuildSummary(r.Context(), a.Store.R, selected, submittedOnly)
	if err != nil {
		return err
	}
	d := summaryDTO{Period: selected, SubmittedOnly: submittedOnly, Stores: []summaryStoreDTO{}, Rows: []summaryRowDTO{},
		StoreTotalsCents: s.StoreTotals, GrandTotalCents: s.Grand}
	for _, st := range s.Stores {
		d.Stores = append(d.Stores, summaryStoreDTO{st.ID, st.Name, st.Archived, st.CalculationEnabled})
	}
	for _, row := range s.Rows {
		d.Rows = append(d.Rows, summaryRowDTO{row.Name, row.Note, row.Price, row.Label, row.Cells, row.CalculationCells, row.Qty, row.CalcQty, row.Sum})
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

// --- per-organisation settings ---------------------------------------------------------------

func (a *App) settingsDTOs(ctx context.Context, q core.Querier, only *int64) ([]reportSettingsDTO, error) {
	enabled, err := reports.CalculationEnabledIDs(ctx, q)
	if err != nil {
		return nil, err
	}
	counts, err := reports.UsagePerOrganisation(ctx, q)
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

func (a *App) listReportSettings(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	l, err := a.settingsDTOs(r.Context(), a.Store.R, nil)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, l)
	return nil
}

func (a *App) updateReportSettings(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	oid := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	enable := body.Bool("calculation_enabled")
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		org, err := orgOr404(ctx, tx, oid)
		if err != nil {
			return err
		}
		cur, err := reports.CalculationEnabled(ctx, tx, oid)
		if err != nil {
			return err
		}
		if cur == enable {
			return nil
		}
		if err := reports.SetCalculationEnabled(ctx, tx, oid, enable); err != nil {
			return err
		}
		state := "вимкнено"
		if enable {
			state = "увімкнено"
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено налаштування звітів",
			org.Name+": режим «По розрахунку» "+state)
	})
	if err != nil {
		return err
	}
	l, err := a.settingsDTOs(r.Context(), a.Store.R, &oid)
	if err != nil || len(l) == 0 {
		return err
	}
	writeJSON(w, http.StatusOK, l[0])
	return nil
}
