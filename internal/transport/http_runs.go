package transport

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"legkyi/internal/core"
)

type runStopDTO struct {
	ID               int64  `json:"id"`
	Position         int    `json:"position"`
	OrganisationID   int64  `json:"organisation_id"`
	OrganisationName string `json:"organisation_name"`
	Place            string `json:"place"`
}

type runDTO struct {
	ID            int64              `json:"id"`
	Kind          string             `json:"kind"`
	ServiceDate   string             `json:"service_date"`
	Car           carDTO             `json:"car"`
	Time          string             `json:"time"`
	Departure     string             `json:"departure"`
	Notes         string             `json:"notes"`
	Status        string             `json:"status"`
	CreatedByName string             `json:"created_by_name"`
	CreatedAt     string             `json:"created_at"`
	UpdatedAt     string             `json:"updated_at"`
	Stops         []runStopDTO       `json:"stops"`
	Manifest      []manifestEntryDTO `json:"manifest"`
}

// runJSON renders a run. ownOrg > 0 is a desk's view: only its own stops and the cargo it ordered.
func runJSON(r Run, cars map[int64]Car, ownOrg int64) runDTO {
	car, ok := cars[r.CarID]
	if !ok {
		car = Car{ID: r.CarID, Plate: NormPlate(r.CarPlate), Active: false}
	}
	d := runDTO{ID: r.ID, Kind: "goods", ServiceDate: r.ServiceDate, Car: carJSON(car), Time: r.Time, Departure: r.Departure,
		Notes: r.Notes, Status: r.Status, CreatedByName: r.CreatedByName,
		CreatedAt: core.ServedTime(time.Unix(r.CreatedAt, 0)), UpdatedAt: core.ServedTime(time.Unix(r.UpdatedAt, 0)),
		Stops: []runStopDTO{}, Manifest: []manifestEntryDTO{}}
	for _, st := range r.Stops {
		if ownOrg != 0 && st.OrganisationID != ownOrg {
			continue
		}
		d.Stops = append(d.Stops, runStopDTO{st.ID, st.Position, st.OrganisationID, st.OrganisationName, st.Place})
		d.Manifest = append(d.Manifest, manifestEntryDTO{st.OrganisationID, st.OrganisationName, st.Place, cargoDTOs(st.Lines)})
	}
	return d
}

func (a *api) carMap(r *http.Request, q core.Querier) (map[int64]Car, error) {
	cars, err := ListCars(r.Context(), q, true)
	if err != nil {
		return nil, err
	}
	m := make(map[int64]Car, len(cars))
	for _, c := range cars {
		m[c.ID] = c
	}
	return m, nil
}

// runScope is the organisation a desk's view is limited to (0 for staff).
func runScope(p *core.Caller) (int64, error) {
	if seesAll(p) {
		return 0, nil
	}
	if p.Org == nil {
		return 0, core.HTTPError{Status: 403, Detail: "Недостатньо прав для цієї дії."}
	}
	return p.Org.ID, nil
}

func runsJSON(list []Run, cars map[int64]Car, ownOrg int64) []runDTO {
	out := make([]runDTO, 0, len(list))
	for _, r := range list {
		out = append(out, runJSON(r, cars, ownOrg))
	}
	return out
}

func (a *api) listRuns(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	date := pm.String("date")
	if err := pm.Err(); err != nil {
		return err
	}
	if date == "" {
		date = a.today()
	}
	if !ValidDate(date) {
		return core.HTTPError{Status: 400, Detail: "Дата має мати вигляд 2026-10-31"}
	}
	own, err := runScope(p)
	if err != nil {
		return err
	}
	list, err := ListRuns(r.Context(), a.Read, RunFilter{From: date, To: date, OrganisationID: own})
	if err != nil {
		return err
	}
	cars, err := a.carMap(r, a.Read)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, map[string]any{"items": runsJSON(list, cars, own)})
	return nil
}

func parseRun(r *http.Request) (RunInput, int64, error) {
	body, err := core.ReadBody(r)
	if err != nil {
		return RunInput{}, 0, err
	}
	in := RunInput{
		ServiceDate: strings.TrimSpace(body.String("service_date", 10, 10)),
		Time:        strings.TrimSpace(body.String("time", 1, 5)),
		Departure:   strings.TrimSpace(body.OptString("departure", "", 300)),
		Notes:       strings.TrimSpace(body.OptString("notes", "", 1000)),
	}
	carID := body.Int("car_id", 1, false)
	if in.ServiceDate != "" && !ValidDate(in.ServiceDate) {
		body.Fail("service_date", "Дата має мати вигляд 2026-10-31", "value_error")
	}
	if in.Time != "" && !ValidTime(in.Time) {
		body.Fail("time", "Час має мати вигляд ГГ:ХХ", "value_error")
	}
	if in.Departure == "" {
		in.Departure = DefaultDeparture
	}
	if !body.Has("stops") {
		body.Fail("stops", "Field required", "missing")
	}
	for _, s := range body.ObjectList("stops", 30) {
		st := StopInput{OrganisationID: s.Int("organisation_id", 1, false), Place: strings.TrimSpace(s.OptString("place", "", 200))}
		st.Lines = readLinesOpt(s)
		in.Stops = append(in.Stops, st)
	}
	if err := body.Err(); err != nil {
		return in, 0, err
	}
	if len(in.Stops) == 0 {
		return in, 0, core.FormError{Message: "Додайте хоча б одну зупинку маршруту."}
	}
	return in, carID, nil
}

// readLinesOpt reads the optional lines of a stop.
func readLinesOpt(b *core.Body) []Line {
	var out []Line
	for _, l := range b.ObjectList("lines", 100) {
		out = append(out, Line{ItemID: l.Int("item_id", 1, false), Quantity: l.Int("quantity", 1, false)})
	}
	return out
}

// busyText explains a CarLock refusal.
func busyText(c Conflict) string {
	span := c.Start.Format("15:04") + "–" + c.Start.Add(CarLock).Format("15:04")
	what := "іншим замовленням"
	if c.RunID != 0 {
		what = "рейсом з доставки продукції"
	}
	return "Авто " + c.Car + " уже зайняте " + what + ": " + span + " (авто тримається " + strconv.Itoa(int(CarLock.Hours())) + " год). Оберіть інший час або авто."
}

// prepareRun resolves the car and the desks of a run input inside the write transaction and checks CarLock.
func (a *api) prepareRun(r *http.Request, tx *sql.Tx, in *RunInput, carID, excludeRun int64, keepCar int64) error {
	car, err := GetCar(r.Context(), tx, carID)
	if errors.Is(err, ErrCarNotFound) {
		return core.FormError{Message: "Авто не знайдено в автопарку."}
	}
	if err != nil {
		return err
	}
	if !car.Active && car.ID != keepCar {
		return core.FormError{Message: "Авто " + car.Display() + " виведено з автопарку."}
	}
	in.Car = car
	for i := range in.Stops {
		org, err := a.Organisation(r.Context(), tx, in.Stops[i].OrganisationID)
		if err != nil {
			return err
		}
		if org == nil || org.Archived {
			return core.FormError{Message: "Підрозділ зупинки не знайдено."}
		}
		if in.Stops[i].Place == "" {
			in.Stops[i].Place = org.Name
		}
	}
	conflicts, err := FindRunConflicts(r.Context(), tx, in.ServiceDate, car.Display(), in.Time, excludeRun)
	if err != nil {
		return err
	}
	if len(conflicts) > 0 {
		return core.HTTPError{Status: 409, Detail: busyText(conflicts[0])}
	}
	return nil
}

// notifyRunDesks tells the desks that have cargo on a run (once per desk).
func (a *api) notifyRunDesks(r *http.Request, tx *sql.Tx, actor int64, run Run, title string, onlyWithCargo bool, extra string) error {
	seen := map[int64]bool{}
	for _, st := range run.Stops {
		if seen[st.OrganisationID] || (onlyWithCargo && len(st.Lines) == 0) {
			continue
		}
		seen[st.OrganisationID] = true
		body := core.JoinNames(run.ServiceDate+" "+run.Time, "авто "+CarText(run.CarPlate), extra)
		if len(st.Lines) > 0 {
			body = core.JoinNames(body, linesSummary(st.Lines))
		}
		if err := a.NotifyHolders(r.Context(), tx, actor, st.OrganisationID, []string{Create}, "transport.run", title, body, "/admin/transport"); err != nil {
			return err
		}
	}
	return nil
}

func (a *api) createRun(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	in, carID, err := parseRun(r)
	if err != nil {
		return err
	}
	ip, name := a.ClientIP(r), p.DisplayName()
	var run Run
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		if err := a.prepareRun(r, tx, &in, carID, 0, 0); err != nil {
			return err
		}
		id, err := CreateRun(r.Context(), tx, p.ID, name, in, a.Now())
		if err != nil {
			return err
		}
		if run, err = GetRun(r.Context(), tx, id); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "створено рейс доставки продукції", core.JoinNames(run.ServiceDate+" "+run.Time, CarText(run.CarPlate))); err != nil {
			return err
		}
		return a.notifyRunDesks(r, tx, p.ID, run, "Продукцію заплановано в рейс", true, "")
	})
	if err != nil {
		return err
	}
	return a.writeRun(w, r, run.ID)
}

func (a *api) writeRun(w http.ResponseWriter, r *http.Request, id int64) error {
	run, err := GetRun(r.Context(), a.Read, id)
	if err != nil {
		return err
	}
	cars, err := a.carMap(r, a.Read)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, runJSON(run, cars, 0))
	return nil
}

func (a *api) updateRun(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	in, carID, err := parseRun(r)
	if err != nil {
		return err
	}
	ip := a.ClientIP(r)
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		old, err := GetRun(r.Context(), tx, id)
		if errors.Is(err, ErrRunNotFound) {
			return core.HTTPError{Status: 404, Detail: "Рейс не знайдено."}
		}
		if err != nil {
			return err
		}
		if old.Status != RunPlanned {
			return core.HTTPError{Status: 409, Detail: "Рейс уже виконується, закрито чи скасовано: змінити його не можна."}
		}
		if err := a.prepareRun(r, tx, &in, carID, id, old.CarID); err != nil {
			return err
		}
		if err := UpdateRun(r.Context(), tx, id, in, a.Now()); err != nil {
			return err
		}
		run, err := GetRun(r.Context(), tx, id)
		if err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "змінено рейс доставки продукції", core.JoinNames(run.ServiceDate+" "+run.Time, CarText(run.CarPlate))); err != nil {
			return err
		}
		return a.notifyRunDesks(r, tx, p.ID, run, "Рейс з вашою продукцією змінено", true, "")
	})
	if err != nil {
		return err
	}
	return a.writeRun(w, r, id)
}

func (a *api) setRunStatus(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	status := body.Literal("status", RunInProgress, RunDone, RunCancelled)
	note := strings.TrimSpace(body.OptString("note", "", 500))
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		run, err := GetRun(r.Context(), tx, id)
		if errors.Is(err, ErrRunNotFound) {
			return core.HTTPError{Status: 404, Detail: "Рейс не знайдено."}
		}
		if err != nil {
			return err
		}
		if !CanSetRun(run.Status, status) {
			return core.HTTPError{Status: 409, Detail: "Цей статус не можна встановити для рейсу в поточному стані."}
		}
		if err := SetRunStatus(r.Context(), tx, id, status, a.Now()); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "змінено статус рейсу доставки продукції", core.JoinNames(run.ServiceDate+" "+run.Time, CarText(run.CarPlate))+" → "+status); err != nil {
			return err
		}
		return a.notifyRunDesks(r, tx, p.ID, run, "Рейс з продукцією: "+runStatusLabel(status), false, note)
	})
	if err != nil {
		return err
	}
	return a.writeRun(w, r, id)
}

func runStatusLabel(s string) string {
	switch s {
	case RunInProgress:
		return "виїхав"
	case RunDone:
		return "виконано"
	case RunCancelled:
		return "скасовано"
	}
	return s
}
