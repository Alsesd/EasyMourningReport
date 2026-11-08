package transport

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"legkyi/internal/core"
)

type itemCarrierDTO struct {
	Kind       string `json:"kind"`
	ID         int64  `json:"id"`
	CarDisplay string `json:"car_display"`
	Time       string `json:"time"`
	Status     string `json:"status"`
	Quantity   int64  `json:"quantity"`
}

type requestItemDTO struct {
	ID             int64            `json:"id"`
	ProductID      int64            `json:"product_id"`
	ProductName    string           `json:"product_name"`
	Quantity       int64            `json:"quantity"`
	Loaded         int64            `json:"loaded"`
	Remaining      int64            `json:"remaining"`
	UnitPriceCents *int64           `json:"unit_price_cents"`
	TotalCents     *int64           `json:"total_cents"`
	Carriers       []itemCarrierDTO `json:"carriers"`
}

type requestDTO struct {
	ID               int64            `json:"id"`
	OrganisationID   int64            `json:"organisation_id"`
	OrganisationName string           `json:"organisation_name"`
	NeedDate         string           `json:"need_date"`
	Deceased         string           `json:"deceased"`
	Notes            string           `json:"notes"`
	Status           string           `json:"status"`
	ReplyNote        string           `json:"reply_note"`
	SubmittedByName  string           `json:"submitted_by_name"`
	CreatedAt        string           `json:"created_at"`
	UpdatedAt        string           `json:"updated_at"`
	Car              *carDTO          `json:"car"`
	TotalCents       int64            `json:"total_cents"`
	Items            []requestItemDTO `json:"items"`
}

func requestJSON(r Request) requestDTO {
	d := requestDTO{ID: r.ID, OrganisationID: r.OrganisationID, OrganisationName: r.OrganisationName, NeedDate: r.NeedDate,
		Deceased: r.Deceased, Notes: r.Notes, Status: r.Status, ReplyNote: r.ReplyNote, SubmittedByName: r.SubmittedByName,
		CreatedAt: core.ServedTime(time.Unix(r.CreatedAt, 0)), UpdatedAt: core.ServedTime(time.Unix(r.UpdatedAt, 0)),
		TotalCents: r.TotalCents(), Items: make([]requestItemDTO, 0, len(r.Items))}
	if r.Car != nil {
		c := carJSON(*r.Car)
		d.Car = &c
	}
	for _, it := range r.Items {
		x := requestItemDTO{ID: it.ID, ProductID: it.ProductID, ProductName: it.ProductName, Quantity: it.Quantity, Loaded: it.Loaded,
			Remaining: it.Remaining(), UnitPriceCents: it.UnitPriceCents, TotalCents: it.TotalCents(), Carriers: make([]itemCarrierDTO, 0, len(it.Carriers))}
		for _, c := range it.Carriers {
			x.Carriers = append(x.Carriers, itemCarrierDTO{c.Kind, c.ID, c.CarDisplay, c.Time, c.Status, c.Quantity})
		}
		d.Items = append(d.Items, x)
	}
	return d
}

func requestsJSON(l []Request) []requestDTO {
	out := make([]requestDTO, 0, len(l))
	for _, r := range l {
		out = append(out, requestJSON(r))
	}
	return out
}

// openRequestsHorizon is how far ahead the dispatcher's "unplanned" panel looks for requests that still need a car.
const openRequestsHorizon = 120

// requestScope limits requests to what the caller may see: a desk its own organisation, staff everything (or the
// organisation asked for). It returns the organisation id to filter by, 0 for all.
func requestScope(p *core.Caller, asked *int64) (int64, error) {
	if !seesAll(p) {
		if p.Org == nil {
			return 0, core.HTTPError{Status: 403, Detail: "Недостатньо прав для цієї дії."}
		}
		return p.Org.ID, nil
	}
	if asked != nil {
		return *asked, nil
	}
	return 0, nil
}

// openRequests lists the requests that are not fully planned yet, needed up to openRequestsHorizon days after date.
func openRequests(a *api, r *http.Request, org int64, date string) ([]Request, error) {
	day, _ := time.Parse("2006-01-02", date)
	where, args := "WHERE r.status = ? AND r.need_date <= ?", []any{RequestSubmitted, day.AddDate(0, 0, openRequestsHorizon).Format("2006-01-02")}
	if org != 0 {
		where += " AND r.organisation_id = ?"
		args = append(args, org)
	}
	all, err := LoadRequests(r.Context(), a.Read, where, args...)
	if err != nil {
		return nil, err
	}
	out := all[:0]
	for _, q := range all {
		if q.Open() {
			out = append(out, q)
		}
	}
	return out, nil
}

func (a *api) listRequests(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	date := pm.String("date")
	open := pm.String("open") == "1"
	asked := pm.OptInt("organisation_id")
	if err := pm.Err(); err != nil {
		return err
	}
	if date == "" {
		date = a.today()
	}
	if !ValidDate(date) {
		return core.HTTPError{Status: 400, Detail: "Дата має мати вигляд 2026-10-31"}
	}
	org, err := requestScope(p, asked)
	if err != nil {
		return err
	}
	var list []Request
	if open {
		list, err = openRequests(a, r, org, date)
	} else {
		where, args := "WHERE r.need_date = ?", []any{date}
		if org != 0 {
			where += " AND r.organisation_id = ?"
			args = append(args, org)
		}
		list, err = LoadRequests(r.Context(), a.Read, where, args...)
	}
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, map[string]any{"items": requestsJSON(list)})
	return nil
}

// parseRequest validates a request body (create and edit share it).
func parseRequest(r *http.Request) (RequestInput, error) {
	body, err := core.ReadBody(r)
	if err != nil {
		return RequestInput{}, err
	}
	in := RequestInput{
		NeedDate: strings.TrimSpace(body.String("need_date", 10, 10)),
		Deceased: strings.TrimSpace(body.OptString("deceased", "", 200)),
		Notes:    strings.TrimSpace(body.OptString("notes", "", 1000)),
	}
	if in.NeedDate != "" && !ValidDate(in.NeedDate) {
		body.Fail("need_date", "Дата має мати вигляд 2026-10-31", "value_error")
	}
	carID := body.OptInt("car_id")
	if carID != nil && *carID < 1 {
		body.Fail("car_id", "Некоректне авто", "value_error")
	}
	if !body.Has("items") {
		body.Fail("items", "Field required", "missing")
	}
	merged := map[int64]int{}
	for _, it := range body.ObjectList("items", 100) {
		pid := it.Int("product_id", 1, false)
		qty := it.Int("quantity", 1, false)
		if qty > 100000 {
			it.Fail("quantity", "Забагато", "value_error")
		}
		if i, ok := merged[pid]; ok { // the same product twice is one line
			in.Items[i].Quantity += qty
			continue
		}
		merged[pid] = len(in.Items)
		in.Items = append(in.Items, NewItem{ProductID: pid, Quantity: qty})
	}
	if err := body.Err(); err != nil {
		return in, err
	}
	if len(in.Items) == 0 {
		return in, core.FormError{Message: "Додайте хоча б один товар."}
	}
	if carID != nil {
		in.Car = &Car{ID: *carID}
	}
	return in, nil
}

// nameItems checks every product against the active catalogue and snapshots its name.
func (a *api) nameItems(r *http.Request, tx *sql.Tx, in *RequestInput, keepCar int64) error {
	cat, err := a.activeCatalog(r, tx)
	if err != nil {
		return err
	}
	names := map[int64]string{}
	prices := map[int64]*int64{}
	for _, c := range cat {
		names[c.ID] = c.Name
		prices[c.ID] = c.PriceCents
	}
	for i := range in.Items {
		n, ok := names[in.Items[i].ProductID]
		if !ok {
			return core.FormError{Message: "Цей товар недоступний для замовлення."}
		}
		in.Items[i].ProductName = n
		in.Items[i].UnitPriceCents = prices[in.Items[i].ProductID]
	}
	if in.Car != nil { // a preference: the car must be a fleet car (an inactive one stays if the request already has it)
		c, err := GetCar(r.Context(), tx, in.Car.ID)
		if errors.Is(err, ErrCarNotFound) {
			return core.FormError{Message: "Авто не знайдено в автопарку."}
		}
		if err != nil {
			return err
		}
		if !c.Active && c.ID != keepCar {
			return core.FormError{Message: "Авто " + c.Display() + " виведено з автопарку."}
		}
		in.Car = &c
	}
	return nil
}

func requestSummary(in RequestInput) string {
	parts := make([]string, 0, len(in.Items))
	for _, it := range in.Items {
		parts = append(parts, it.ProductName+" ×"+itoa(it.Quantity))
	}
	return strings.Join(parts, ", ")
}

func (a *api) createRequest(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	in, err := parseRequest(r)
	if err != nil {
		return err
	}
	ip, name := a.ClientIP(r), p.DisplayName()
	var id int64
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		if err := a.nameItems(r, tx, &in, 0); err != nil {
			return err
		}
		var err error
		if id, err = CreateRequest(r.Context(), tx, p.Org.ID, p.ID, name, in, a.Now()); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "створено заявку на продукцію", core.JoinNames(in.Deceased, in.NeedDate, requestSummary(in))); err != nil {
			return err
		}
		return a.NotifyHolders(r.Context(), tx, p.ID, 0, []string{Manage}, "transport.request", "Нова заявка на продукцію",
			core.JoinNames(p.Org.Name, in.Deceased, in.NeedDate, requestSummary(in)), "/admin/transport")
	})
	if err != nil {
		return err
	}
	return a.writeRequest(w, r, id)
}

func (a *api) writeRequest(w http.ResponseWriter, r *http.Request, id int64) error {
	req, err := GetRequest(r.Context(), a.Read, id)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, requestJSON(req))
	return nil
}

// ownRequest loads a request of the caller's own organisation (others answer 404, like orders).
func ownRequest(r *http.Request, tx *sql.Tx, p *core.Caller, id int64) (Request, error) {
	req, err := GetRequest(r.Context(), tx, id)
	if errors.Is(err, ErrRequestNotFound) || (err == nil && (p.Org == nil || req.OrganisationID != p.Org.ID)) {
		return req, core.HTTPError{Status: 404, Detail: "Заявку не знайдено."}
	}
	return req, err
}

var errRequestLocked = core.HTTPError{Status: 409, Detail: "Заявку вже опрацьовано (продукцію завантажено, заявку скасовано чи відхилено), змінити її не можна."}

func (a *api) updateRequest(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	in, err := parseRequest(r)
	if err != nil {
		return err
	}
	ip := a.ClientIP(r)
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		req, err := ownRequest(r, tx, p, id)
		if err != nil {
			return err
		}
		if req.Status != RequestSubmitted {
			return errRequestLocked
		}
		if err := a.nameItems(r, tx, &in, existingCarID(req)); err != nil {
			return err
		}
		if err := UpdateRequest(r.Context(), tx, id, in, a.Now()); err != nil {
			return err
		}
		return a.Audit(tx, ip, p, "змінено заявку на продукцію", core.JoinNames(in.Deceased, in.NeedDate, requestSummary(in)))
	})
	if err != nil {
		return err
	}
	return a.writeRequest(w, r, id)
}

func (a *api) cancelRequest(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	err := a.Write(r.Context(), func(tx *sql.Tx) error {
		req, err := ownRequest(r, tx, p, id)
		if err != nil {
			return err
		}
		if req.Status != RequestSubmitted {
			return core.HTTPError{Status: 409, Detail: "Заявку вже опрацьовано диспетчером. Зв’яжіться з ним, щоб скасувати."}
		}
		if err := SetRequestStatus(r.Context(), tx, id, RequestCancelled, "", a.Now()); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "скасовано заявку на продукцію", core.JoinNames(req.Deceased, req.NeedDate)); err != nil {
			return err
		}
		return a.NotifyHolders(r.Context(), tx, p.ID, 0, []string{Manage}, "transport.request.cancelled", "Заявку на продукцію скасовано",
			core.JoinNames(req.OrganisationName, req.Deceased, req.NeedDate), "/admin/transport")
	})
	if err != nil {
		return err
	}
	return a.writeRequest(w, r, id)
}

func (a *api) rejectRequest(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("rid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	note := strings.TrimSpace(body.String("note", 0, 500))
	if err := body.Err(); err != nil {
		return err
	}
	if note == "" {
		return core.FormError{Message: "Вкажіть причину відмови."}
	}
	ip := a.ClientIP(r)
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		req, err := GetRequest(r.Context(), tx, id)
		if errors.Is(err, ErrRequestNotFound) {
			return core.HTTPError{Status: 404, Detail: "Заявку не знайдено."}
		}
		if err != nil {
			return err
		}
		if req.Status != RequestSubmitted {
			return core.HTTPError{Status: 409, Detail: "Відхилити можна лише заявку, до якої ще нічого не завантажено."}
		}
		if err := SetRequestStatus(r.Context(), tx, id, RequestRejected, note, a.Now()); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "відхилено заявку на продукцію", core.JoinNames(req.OrganisationName, req.Deceased, req.NeedDate, note)); err != nil {
			return err
		}
		return a.NotifyHolders(r.Context(), tx, p.ID, req.OrganisationID, []string{Create}, "transport.request.rejected", "Заявку на продукцію відхилено",
			core.JoinNames(note, req.Deceased, req.NeedDate), "/admin/transport")
	})
	if err != nil {
		return err
	}
	return a.writeRequest(w, r, id)
}

func existingCarID(r Request) int64 {
	if r.Car == nil {
		return 0
	}
	return r.Car.ID
}
