package reports

import (
	"context"
	"database/sql"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"legkyi/internal/core"
)

// Daily reports over HTTP: a store fills in, saves and submits each day of a month; a reviewer reads a day,
// locks or unlocks it, and sees all stores for one day. See days.go for the storage rules.

const errDailyMonth = "Звіт за цей місяць ведеться по днях. Оберіть день, щоб внести зміни."

var dayRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func (a *api) today() string { return a.Now().In(time.Local).Format("2006-01-02") }

// lastDay is the last date of a YYYY-MM period.
func lastDay(period string) string {
	t, err := time.Parse("2006-01", period)
	if err != nil {
		return period + "-31"
	}
	return t.AddDate(0, 1, -1).Format("2006-01-02")
}

// parseDate checks a YYYY-MM-DD date (a real calendar day); the message names the expected shape.
func parseDate(raw string) (string, error) {
	if !dayRE.MatchString(raw) {
		return "", core.HTTPError{Status: 400, Detail: "День має мати вигляд 2026-11-08"}
	}
	if _, err := time.Parse("2006-01-02", raw); err != nil {
		return "", core.HTTPError{Status: 400, Detail: "Такого дня немає в календарі."}
	}
	return raw, nil
}

// parseDay reads a day of the period from a URL: a date inside the month, not in the future, or "undated" for the
// month's quantities entered before it was kept by days. Returns Undated ("") for the latter.
func (a *api) parseDay(period, raw string) (string, error) {
	if raw == UndatedToken {
		return Undated, nil
	}
	day, err := parseDate(raw)
	if err != nil {
		return "", err
	}
	if day[:7] != period {
		return "", core.HTTPError{Status: 400, Detail: "День " + day + " не належить до місяця " + period + "."}
	}
	if day > a.today() {
		return "", core.HTTPError{Status: 422, Detail: "Не можна звітувати за день, який ще не настав."}
	}
	return day, nil
}

// summaryScope reads the month and optional day of the summary: with a day, the month is the day's own.
func (a *api) summaryScope(rawPeriod, rawDay string) (string, string, error) {
	if rawDay == "" {
		p, err := a.parsePeriod(rawPeriod)
		return p, "", err
	}
	day, err := parseDate(rawDay)
	if err != nil {
		return "", "", err
	}
	if rawPeriod != "" && rawPeriod != day[:7] {
		return "", "", core.HTTPError{Status: 400, Detail: "День " + day + " не належить до місяця " + rawPeriod + "."}
	}
	return day[:7], day, nil
}

func dayToken(day string) string {
	if day == Undated {
		return UndatedToken
	}
	return day
}

// --- DTOs -----------------------------------------------------------------------------------

// monthDayDTO is one day of a month in the day list.
type monthDayDTO struct {
	Day        string `json:"day"` // YYYY-MM-DD
	Status     string `json:"status"`
	TotalCents int64  `json:"total_cents"`
	ItemCount  int    `json:"item_count"`
	signedDTO
}

// monthDaysDTO describes how a month is kept: its days with their state and the range of days that can be filled.
type monthDaysDTO struct {
	ReportID   *int64 `json:"report_id"`
	StoreName  string `json:"store_name"`
	Period     string `json:"period"`
	Status     string `json:"status"` // the month's: new | draft | submitted
	Daily      bool   `json:"daily"`
	TotalCents int64  `json:"total_cents"`
	FirstDay   string `json:"first_day"`
	LastDay    string `json:"last_day"` // the month's last day, or today in the current month
	Today      string `json:"today"`
	// Quantities entered for the whole month before it was kept by days (also for a month never kept by days).
	Undated *monthDayDTO  `json:"undated"`
	Days    []monthDayDTO `json:"days"`
}

// dayReportDTO is one day's report form (store) or detail (reviewer).
type dayReportDTO struct {
	ReportID           *int64            `json:"report_id"`
	StoreID            int64             `json:"store_id"`
	StoreName          string            `json:"store_name"`
	StoreArchived      bool              `json:"store_archived"`
	Period             string            `json:"period"`
	Day                string            `json:"day"` // YYYY-MM-DD or "undated"
	Status             string            `json:"status"`
	MonthStatus        string            `json:"month_status"`
	ReadOnly           bool              `json:"read_only"`
	CalculationEnabled bool              `json:"calculation_enabled"`
	Rows               []reportLineDTO   `json:"rows"`
	InactiveRows       []inactiveLineDTO `json:"inactive_rows"`
	InactiveTotalCents int64             `json:"inactive_total_cents"`
	TotalCents         int64             `json:"total_cents"`
	signedDTO
}

// dailyListItemDTO is one store's state for one day (the reviewer's register for a day).
type dailyListItemDTO struct {
	StoreID       int64  `json:"store_id"`
	StoreName     string `json:"store_name"`
	StoreArchived bool   `json:"store_archived"`
	ReportID      *int64 `json:"report_id"`
	Day           string `json:"day"`
	Status        string `json:"status"` // none | draft | submitted
	TotalCents    int64  `json:"total_cents"`
	ItemCount     int    `json:"item_count"`
	signedDTO
}

// --- building blocks --------------------------------------------------------------------------

// dayState is a day as the handlers see it: a stored day of a daily month, or the virtual undated day of a month
// kept as a whole (its quantities, status and signatures are the month's).
type dayState struct {
	status string // new | draft | submitted
	items  []Item
	sigs   Signatures
}

func (a *api) loadDayState(ctx context.Context, q core.Querier, rep *Report, day string) (dayState, error) {
	if rep == nil {
		return dayState{status: "new"}, nil
	}
	daily, err := IsDaily(ctx, q, rep.ID)
	if err != nil {
		return dayState{}, err
	}
	if !daily {
		if day != Undated {
			return dayState{status: "new"}, nil
		}
		items, err := LoadItems(ctx, q, rep.ID)
		if err != nil {
			return dayState{}, err
		}
		sigs, err := SignaturesOf(ctx, q, rep.ID)
		if err != nil {
			return dayState{}, err
		}
		return dayState{status: rep.Status, items: items, sigs: sigs}, nil
	}
	d, err := LoadDay(ctx, q, rep.ID, day)
	if err != nil || d == nil {
		return dayState{status: "new"}, err
	}
	items, err := LoadDayItems(ctx, q, rep.ID, day)
	if err != nil {
		return dayState{}, err
	}
	return dayState{status: d.Status, items: items, sigs: d.Signatures}, nil
}

func (a *api) dayReportDTO(ctx context.Context, q core.Querier, rep *Report, org *core.Org, period, day string) (dayReportDTO, error) {
	enabled, err := CalculationEnabled(ctx, q, org.ID)
	if err != nil {
		return dayReportDTO{}, err
	}
	st, err := a.loadDayState(ctx, q, rep, day)
	if err != nil {
		return dayReportDTO{}, err
	}
	rows, inactive, inactiveTotal, err := BuildLines(ctx, q, period, st.items, enabled)
	if err != nil {
		return dayReportDTO{}, err
	}
	d := dayReportDTO{StoreID: org.ID, StoreName: org.Name, StoreArchived: org.Archived, Period: period, Day: dayToken(day),
		Status: st.status, MonthStatus: "new", CalculationEnabled: enabled, Rows: lineDTOs(rows), InactiveRows: inactiveDTOs(inactive),
		InactiveTotalCents: inactiveTotal, TotalCents: inactiveTotal, ReadOnly: st.status == "submitted"}
	for _, r := range rows {
		d.TotalCents += r.Sum
	}
	if rep != nil {
		id := rep.ID
		d.ReportID, d.MonthStatus = &id, rep.Status
		d.signedDTO = signedOf(st.status, st.sigs)
		if blocked, err := a.monthBlocksDays(ctx, q, rep, day); err != nil {
			return dayReportDTO{}, err
		} else if blocked {
			d.ReadOnly = true
		}
	}
	return d, nil
}

// monthBlocksDays: a submitted month takes no new days until a reviewer unlocks it — a month kept as a whole
// always, a daily month once it is in the past (in the current month every day being submitted must not block
// tomorrow's entry). Days that already exist follow their own status.
func (a *api) monthBlocksDays(ctx context.Context, q core.Querier, rep *Report, day string) (bool, error) {
	if rep == nil || rep.Status != "submitted" {
		return false, nil
	}
	daily, err := IsDaily(ctx, q, rep.ID)
	if err != nil || !daily {
		return !daily, err
	}
	if rep.Period >= a.currentPeriod() {
		return false, nil
	}
	d, err := LoadDay(ctx, q, rep.ID, day)
	return d == nil, err
}

func (a *api) monthDaysDTO(ctx context.Context, q core.Querier, rep *Report, org *core.Org, period string) (monthDaysDTO, error) {
	today := a.today()
	d := monthDaysDTO{StoreName: org.Name, Period: period, Status: "new", FirstDay: period + "-01", LastDay: lastDay(period),
		Today: today, Days: []monthDayDTO{}}
	if d.LastDay > today {
		d.LastDay = today
	}
	if rep == nil {
		return d, nil
	}
	id := rep.ID
	d.ReportID, d.Status = &id, rep.Status
	items, err := LoadItems(ctx, q, rep.ID)
	if err != nil {
		return d, err
	}
	d.TotalCents = ReportTotal(items)
	days, err := DayTotals(ctx, q, rep.ID)
	if err != nil {
		return d, err
	}
	d.Daily = len(days) > 0
	if !d.Daily {
		if len(items) > 0 {
			sigs, err := SignaturesOf(ctx, q, rep.ID)
			if err != nil {
				return d, err
			}
			d.Undated = &monthDayDTO{Day: UndatedToken, Status: rep.Status, TotalCents: d.TotalCents, ItemCount: len(items), signedDTO: signedOf(rep.Status, sigs)}
		}
		return d, nil
	}
	for _, x := range days {
		md := monthDayDTO{Day: dayToken(x.Day.Day), Status: x.Status, TotalCents: x.Total, ItemCount: x.Count, signedDTO: signedOf(x.Status, x.Signatures)}
		if x.Day.Day == Undated {
			d.Undated = &md
			continue
		}
		d.Days = append(d.Days, md)
	}
	return d, nil
}

// --- store ------------------------------------------------------------------------------------

// storeMonth checks that the store may open the month (the current one, or one it already has a report for).
func (a *api) storeMonth(ctx context.Context, q core.Querier, org int64, period string, status int) error {
	known, err := StorePeriods(ctx, q, org)
	if err != nil {
		return err
	}
	if period != a.currentPeriod() && !known[period] {
		if status == 403 {
			return core.HTTPError{Status: 403, Detail: "Звіту за " + period + " не існує."}
		}
		return core.HTTPError{Status: 404, Detail: "Звіту за " + period + " немає."}
	}
	return nil
}

func (a *api) readStoreDays(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	period, err := a.parsePeriod(core.Param(r, "period"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	if err := a.storeMonth(ctx, a.Read, p.Org.ID, period, 404); err != nil {
		return err
	}
	rep, err := FindReport(ctx, a.Read, p.Org.ID, period)
	if err != nil {
		return err
	}
	d, err := a.monthDaysDTO(ctx, a.Read, rep, p.Org, period)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, d)
	return nil
}

func (a *api) readStoreDay(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	period, err := a.parsePeriod(core.Param(r, "period"))
	if err != nil {
		return err
	}
	day, err := a.parseDay(period, core.Param(r, "day"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	if err := a.storeMonth(ctx, a.Read, p.Org.ID, period, 404); err != nil {
		return err
	}
	rep, err := FindReport(ctx, a.Read, p.Org.ID, period)
	if err != nil {
		return err
	}
	d, err := a.dayReportDTO(ctx, a.Read, rep, p.Org, period, day)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, d)
	return nil
}

func readSaveLines(body *core.Body) []saveLine {
	var lines []saveLine
	for _, item := range body.ObjectList("quantities", 5000) {
		lines = append(lines, saveLine{
			product: item.Int("product_id", 0, true),
			price:   item.Int("price_cents", 0, false),
			qty:     item.Int("quantity", 0, false),
			calc:    item.OptIntMin("quantity_calc", 0),
		})
	}
	return lines
}

// formatDay renders YYYY-MM-DD as DD.MM.YYYY for notifications and the audit log.
func formatDay(day string) string {
	if day == Undated {
		return "без дати"
	}
	if t, err := time.Parse("2006-01-02", day); err == nil {
		return t.Format("02.01.2006")
	}
	return day
}

func (a *api) saveStoreDay(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	period, err := a.parsePeriod(core.Param(r, "period"))
	if err != nil {
		return err
	}
	day, err := a.parseDay(period, core.Param(r, "day"))
	if err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	action := body.OptLiteral("action", "draft", "draft", "submit")
	lines := readSaveLines(body)
	if err := body.Err(); err != nil {
		return err
	}
	orgID, ip := p.Org.ID, a.ClientIP(r)
	var dto dayReportDTO
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		if err := a.storeMonth(ctx, tx, orgID, period, 403); err != nil {
			return err
		}
		rep, err := FindReport(ctx, tx, orgID, period)
		if err != nil {
			return err
		}
		if blocked, err := a.monthBlocksDays(ctx, tx, rep, day); err != nil {
			return err
		} else if blocked {
			return core.HTTPError{Status: 409, Detail: "Звіт за місяць надіслано й заблоковано. Розблокувати його може адміністратор."}
		}
		if rep == nil {
			res, err := tx.ExecContext(ctx, "INSERT INTO reports (store_id, period, status) VALUES (?, ?, 'draft')", orgID, period)
			if err != nil {
				return err
			}
			id, _ := res.LastInsertId()
			rep = &Report{ID: id, StoreID: orgID, Period: period, Status: "draft"}
		}
		if err := MakeDaily(ctx, tx, rep); err != nil {
			return err
		}
		cur, err := LoadDay(ctx, tx, rep.ID, day)
		if err != nil {
			return err
		}
		if cur == nil && day == Undated {
			return core.HTTPError{Status: 404, Detail: "Даних без дати за цей місяць немає."}
		}
		if cur != nil && cur.Status == "submitted" {
			return core.HTTPError{Status: 409, Detail: "Звіт за " + formatDay(day) + " надіслано й заблоковано. Розблокувати його може адміністратор."}
		}
		if err := EnsureDay(ctx, tx, rep.ID, day); err != nil {
			return err
		}
		items, err := LoadDayItems(ctx, tx, rep.ID, day)
		if err != nil {
			return err
		}
		editable, quantities, err := checkedQuantities(ctx, tx, period, items, lines)
		if err != nil {
			return err
		}
		if err := ReplaceDayItems(ctx, tx, rep.ID, day, editable, items, quantities); err != nil {
			return err
		}
		if err := RebuildAggregate(ctx, tx, rep.ID, editable); err != nil {
			return err
		}
		auditAction := "збережено звіт за день"
		if action == "submit" {
			auditAction = "надіслано звіт за день"
			if err := SetDayStatus(ctx, tx, rep.ID, day, "submitted"); err != nil {
				return err
			}
			if err := SignDay(ctx, tx, rep.ID, day, KindStore, p.ID, p.DisplayName(), a.Now()); err != nil {
				return err
			}
		}
		if _, err := SyncMonthStatus(ctx, tx, rep); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, auditAction, core.JoinNames(p.Org.Name, formatDay(day))); err != nil {
			return err
		}
		if action == "submit" {
			if err := a.NotifyHolders(ctx, tx, p.ID, 0, []string{Review}, "report.day_submitted", "Звіт за день надіслано",
				core.JoinNames(p.Org.Name, formatDay(day)), "/admin/reports/"+strconv.FormatInt(rep.ID, 10)+"?day="+dayToken(day)); err != nil {
				return err
			}
		}
		dto, err = a.dayReportDTO(ctx, tx, rep, p.Org, period, day)
		return err
	})
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, dto)
	return nil
}

// --- review -----------------------------------------------------------------------------------

func (a *api) reportAndOrg(ctx context.Context, q core.Querier, r *http.Request) (*Report, *core.Org, error) {
	pm := core.Query(r)
	rid := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return nil, nil, err
	}
	rep, err := reportOr404(ctx, q, rid)
	if err != nil {
		return nil, nil, err
	}
	org, err := a.Organisation(ctx, q, rep.StoreID)
	if err != nil {
		return nil, nil, err
	}
	if org == nil {
		org = &core.Org{ID: rep.StoreID, Name: "?"}
	}
	return rep, org, nil
}

func (a *api) readAdminDays(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	ctx := r.Context()
	rep, org, err := a.reportAndOrg(ctx, a.Read, r)
	if err != nil {
		return err
	}
	d, err := a.monthDaysDTO(ctx, a.Read, rep, org, rep.Period)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, d)
	return nil
}

// adminDay reads a day of a report for a reviewer: any date of the report's month, or "undated".
func adminDay(period, raw string) (string, error) {
	if raw == UndatedToken {
		return Undated, nil
	}
	day, err := parseDate(raw)
	if err != nil {
		return "", err
	}
	if day[:7] != period {
		return "", core.HTTPError{Status: 400, Detail: "День " + day + " не належить до місяця " + period + "."}
	}
	return day, nil
}

func (a *api) readAdminDay(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	ctx := r.Context()
	rep, org, err := a.reportAndOrg(ctx, a.Read, r)
	if err != nil {
		return err
	}
	day, err := adminDay(rep.Period, core.Param(r, "day"))
	if err != nil {
		return err
	}
	d, err := a.dayReportDTO(ctx, a.Read, rep, org, rep.Period, day)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, d)
	return nil
}

func (a *api) updateAdminDayStatus(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	target := body.Literal("status", "draft", "submitted")
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	var dto dayReportDTO
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		rep, org, err := a.reportAndOrg(ctx, tx, r)
		if err != nil {
			return err
		}
		day, err := adminDay(rep.Period, core.Param(r, "day"))
		if err != nil {
			return err
		}
		if err := MakeDaily(ctx, tx, rep); err != nil {
			return err
		}
		cur, err := LoadDay(ctx, tx, rep.ID, day)
		if err != nil {
			return err
		}
		if cur == nil {
			return core.HTTPError{Status: 404, Detail: "Звіту за " + formatDay(day) + " немає."}
		}
		if cur.Status != target {
			if err := SetDayStatus(ctx, tx, rep.ID, day, target); err != nil {
				return err
			}
			// A reviewer's lock is recorded as such and never replaces the employee's signature.
			if target == "submitted" {
				if err := SignDay(ctx, tx, rep.ID, day, KindAdmin, p.ID, p.DisplayName(), a.Now()); err != nil {
					return err
				}
			}
			if _, err := SyncMonthStatus(ctx, tx, rep); err != nil {
				return err
			}
			action := "розблоковано звіт за день"
			if target == "submitted" {
				action = "заблоковано звіт за день"
			}
			if err := a.Audit(tx, ip, p, action, core.JoinNames(org.Name, formatDay(day))); err != nil {
				return err
			}
		}
		dto, err = a.dayReportDTO(ctx, tx, rep, org, rep.Period, day)
		return err
	})
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, dto)
	return nil
}

// setAllDays gives every day of a daily month the status the reviewer set on the whole month (lock: drafts become
// submitted with the reviewer's signature; unlock: every day opens). A month kept as a whole has no days.
func (a *api) setAllDays(ctx context.Context, tx *sql.Tx, rep *Report, target string, p *core.Caller) error {
	days, err := DayTotals(ctx, tx, rep.ID)
	if err != nil {
		return err
	}
	for _, d := range days {
		if d.Status == target {
			continue
		}
		if err := SetDayStatus(ctx, tx, rep.ID, d.Day.Day, target); err != nil {
			return err
		}
		if target == "submitted" {
			if err := SignDay(ctx, tx, rep.ID, d.Day.Day, KindAdmin, p.ID, p.DisplayName(), a.Now()); err != nil {
				return err
			}
		}
	}
	return nil
}

// listDailyReports is the register for one day: every store's state and total for that date.
func (a *api) listDailyReports(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	raw := core.Query(r).String("day")
	if raw == "" {
		raw = a.today()
	}
	day, err := parseDate(raw)
	if err != nil {
		return err
	}
	ctx := r.Context()
	type state struct {
		reportID int64
		day      *Day
		total    int64
		count    int
	}
	byStore := map[int64]*state{}
	rows, err := a.Read.QueryContext(ctx, "SELECT id, store_id FROM reports WHERE period = ?", day[:7])
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, sid int64
		if err := rows.Scan(&id, &sid); err != nil {
			rows.Close()
			return err
		}
		byStore[sid] = &state{reportID: id}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, st := range byStore {
		if st.day, err = LoadDay(ctx, a.Read, st.reportID, day); err != nil {
			return err
		}
		if st.day == nil {
			continue
		}
		if err := a.Read.QueryRowContext(ctx, `SELECT COALESCE(SUM(quantity * unit_price_cents), 0), COUNT(id)
			FROM report_day_items WHERE report_id = ? AND day = ?`, st.reportID, day).Scan(&st.total, &st.count); err != nil {
			return err
		}
	}
	orgs, err := a.Read.QueryContext(ctx, "SELECT id, name, archived FROM organisations ORDER BY name")
	if err != nil {
		return err
	}
	defer orgs.Close()
	out := []dailyListItemDTO{}
	for orgs.Next() {
		var id int64
		var name string
		var arch int
		if err := orgs.Scan(&id, &name, &arch); err != nil {
			return err
		}
		st := byStore[id]
		has := st != nil && st.day != nil
		if arch != 0 && !has {
			continue
		}
		d := dailyListItemDTO{StoreID: id, StoreName: name, StoreArchived: arch != 0, Day: day, Status: "none"}
		if st != nil {
			rid := st.reportID
			d.ReportID = &rid
		}
		if has {
			d.Status, d.TotalCents, d.ItemCount = st.day.Status, st.total, st.count
			d.signedDTO = signedOf(st.day.Status, st.day.Signatures)
		}
		out = append(out, d)
	}
	core.WriteJSON(w, http.StatusOK, out)
	return orgs.Err()
}
