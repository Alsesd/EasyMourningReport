package transport

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"legkyi/internal/core"
)

type orgRefDTO struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type transportStatusDTO struct {
	Ready   bool   `json:"ready"`
	Message string `json:"message"`
}

type deliveryDTO struct {
	CarNumber   string   `json:"car_number"`
	Departure   string   `json:"departure"`
	Time        string   `json:"time"`
	Destination string   `json:"destination"`
	Stops       []string `json:"stops"`
}

type carriersDTO struct {
	CarNumber      string   `json:"car_number"`
	Departure      string   `json:"departure"`
	Count          int      `json:"count"`
	Time           string   `json:"time"`
	CemeteryNumber string   `json:"cemetery_number"`
	Stops          []string `json:"stops"`
	Bearers        []string `json:"bearers"`
}

type orderEventDTO struct {
	TS       string `json:"ts"`
	UserName string `json:"user_name"`
	Kind     string `json:"kind"`
	Status   string `json:"status"`
	Note     string `json:"note"`
}

type transportOrderDTO struct {
	ID           int64           `json:"id"`
	Organisation orgRefDTO       `json:"organisation"`
	ServiceDate  string          `json:"service_date"`
	Deceased     string          `json:"deceased"`
	Notes        string          `json:"notes"`
	SameCar      bool            `json:"same_car"`
	Military     bool            `json:"military"`
	Status       string          `json:"status"`
	ReplyNote    string          `json:"reply_note"`
	Delivery     *deliveryDTO    `json:"delivery"`
	Carriers     *carriersDTO    `json:"carriers"`
	SortTime     string          `json:"sort_time"`
	SubmittedBy  string          `json:"submitted_by"`
	CreatedAt    string          `json:"created_at"`
	UpdatedAt    string          `json:"updated_at"`
	CanEdit      bool            `json:"can_edit"`
	NextStatuses []string        `json:"next_statuses"`
	Events       []orderEventDTO `json:"events"`
}

// api holds the platform services the handlers use (core.Services is all the module gets from the shell).
type api struct{ core.Services }

// routes lists the module's endpoints; the shell registers each behind its permission check.
func routes(s core.Services) []core.Route {
	a := &api{s}
	anyCode := []string{Create, ViewAll, Manage}
	create := []string{Create}
	manage := []string{Manage}
	return []core.Route{
		{Method: "GET", Path: "/transport/status", Codes: anyCode, Handler: func(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
			core.WriteJSON(w, http.StatusOK, transportStatusDTO{true, "Замовлення транспорту: створюйте записи на день і стежте за відповіддю диспетчера."})
			return nil
		}},
		{Method: "GET", Path: "/transport/orders", Codes: anyCode, Handler: a.listTransportOrders},
		{Method: "GET", Path: "/transport/days", Codes: anyCode, Handler: a.listTransportDays},
		{Method: "GET", Path: "/transport/orders/{oid}", Codes: anyCode, Handler: a.readTransportOrder},
		{Method: "POST", Path: "/transport/orders", Codes: create, Member: true, Handler: a.createTransportOrder},
		{Method: "PUT", Path: "/transport/orders/{oid}", Codes: create, Member: true, Handler: a.updateTransportOrder},
		{Method: "POST", Path: "/transport/orders/{oid}/cancel", Codes: create, Member: true, Handler: a.cancelTransportOrder},
		{Method: "PUT", Path: "/transport/orders/{oid}/bearers", Codes: manage, Handler: a.setTransportBearers},
		{Method: "POST", Path: "/transport/orders/{oid}/status", Codes: manage, Handler: a.setTransportOrderStatus},
	}
}

// seesAll: whoever holds view_all or manage sees every division's orders (a dispatcher may belong to a division
// or to none); everyone else only their own division's.
func seesAll(p *core.Caller) bool {
	return p.Can(ViewAll, Manage)
}

func (a *api) orderDTO(o Order, p *core.Caller, events []Event) transportOrderDTO {
	d := transportOrderDTO{
		ID: o.ID, Organisation: orgRefDTO{o.OrganisationID, o.OrganisationName},
		ServiceDate: o.ServiceDate, Deceased: o.Deceased, Notes: o.Notes, SameCar: o.SameCar(), Military: o.Military, Status: o.Status, ReplyNote: o.ReplyNote,
		SortTime: o.SortTime(), SubmittedBy: o.SubmittedByName,
		CreatedAt: core.ServedTime(time.Unix(o.CreatedAt, 0)), UpdatedAt: core.ServedTime(time.Unix(o.UpdatedAt, 0)),
		CanEdit:      p.Org != nil && (o.Status == Submitted || o.Status == Bumped) && p.Can(Create),
		NextStatuses: []string{}, Events: []orderEventDTO{},
	}
	if o.Delivery != nil {
		d.Delivery = &deliveryDTO{o.Delivery.CarNumber, o.Delivery.Departure, o.Delivery.Time, o.Delivery.Destination, o.Delivery.Stops}
	}
	if o.Carriers != nil {
		d.Carriers = &carriersDTO{o.Carriers.CarNumber, o.Carriers.Departure, o.Carriers.Count, o.Carriers.Time, o.Carriers.CemeteryNumber, o.Carriers.Stops, o.Carriers.Bearers}
	}
	if p.Can(Manage) {
		d.NextStatuses = append(d.NextStatuses, ManagerNext[o.Status]...)
	}
	for _, e := range events {
		d.Events = append(d.Events, orderEventDTO{core.ServedTime(time.Unix(e.TS, 0)), e.UserName, e.Kind, e.Status, e.Note})
	}
	return d
}

// loadOrder resolves an order the caller may see; other divisions' orders answer 404 unless the caller may
// see every division's orders.
func (a *api) loadOrder(r *http.Request, q core.Querier, p *core.Caller, id int64) (Order, error) {
	return a.findOrder(r, q, p, id, seesAll(p))
}

// loadOwnOrder resolves an order of the caller's own division only. Editing and cancelling use it: seeing every
// division's orders (manage, view_all) never lets someone rewrite another division's order.
func (a *api) loadOwnOrder(r *http.Request, q core.Querier, p *core.Caller, id int64) (Order, error) {
	return a.findOrder(r, q, p, id, false)
}

func (a *api) findOrder(r *http.Request, q core.Querier, p *core.Caller, id int64, all bool) (Order, error) {
	o, err := GetOrder(r.Context(), q, id)
	if errors.Is(err, ErrNotFound) || (err == nil && !all && (p.Org == nil || o.OrganisationID != p.Org.ID)) {
		return o, core.HTTPError{Status: 404, Detail: "Замовлення не знайдено."}
	}
	return o, err
}

func (a *api) today() string { return a.Now().In(time.Local).Format("2006-01-02") }

// orderFilter reads the day or range of a list request (date=, or from= and to=; today without either) and
// limits it to what the caller may see: a desk only its own division, staff every division or the one asked for.
func (a *api) orderFilter(r *http.Request, p *core.Caller) (Filter, error) {
	pm := core.Query(r)
	date, from, to := pm.String("date"), pm.String("from"), pm.String("to")
	status := pm.String("status")
	org := pm.OptInt("organisation_id")
	if err := pm.Err(); err != nil {
		return Filter{}, err
	}
	if date == "" && from == "" && to == "" {
		date = a.today()
	}
	if date == "" && (from == "" || to == "") {
		return Filter{}, core.HTTPError{Status: 400, Detail: "Вкажіть обидві дати діапазону: from і to."}
	}
	if date != "" {
		from, to = date, date
	}
	for _, v := range []string{from, to} {
		if v != "" && !ValidDate(v) {
			return Filter{}, core.HTTPError{Status: 400, Detail: "Дата має мати вигляд 2026-10-31"}
		}
	}
	if from != "" && to != "" {
		f, _ := time.Parse("2006-01-02", from)
		t, _ := time.Parse("2006-01-02", to)
		if t.Before(f) || t.Sub(f) > 400*24*time.Hour {
			return Filter{}, core.HTTPError{Status: 400, Detail: "Некоректний діапазон дат."}
		}
	}
	filter := Filter{From: from, To: to, Status: status}
	switch {
	case !seesAll(p):
		if p.Org == nil {
			return Filter{}, core.HTTPError{Status: 403, Detail: "Недостатньо прав для цієї дії."}
		}
		filter.OrganisationID = p.Org.ID
	case org != nil:
		filter.OrganisationID = *org
	}
	return filter, nil
}

func (a *api) listTransportOrders(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	filter, err := a.orderFilter(r, p)
	if err != nil {
		return err
	}
	orders, err := ListOrders(r.Context(), a.Read, filter)
	if err != nil {
		return err
	}
	out := make([]transportOrderDTO, 0, len(orders))
	for _, o := range orders {
		out = append(out, a.orderDTO(o, p, nil))
	}
	core.WriteJSON(w, http.StatusOK, out)
	return nil
}

type transportDayDTO struct {
	Date  string `json:"date"`
	Total int    `json:"total"`
	// Open: orders still being worked on (submitted, accepted, in progress, car taken).
	Open int `json:"open"`
	// Attention: orders waiting for this caller. A dispatcher answers the submitted ones; a desk re-sends the
	// orders whose car was taken.
	Attention int `json:"attention"`
	// MilitaryOpen: open military orders (they take a car from an ordinary order).
	MilitaryOpen int            `json:"military_open"`
	ByStatus     map[string]int `json:"by_status"`
}

// listTransportDays counts the orders of every day in the range (only days with orders), for the date strip.
func (a *api) listTransportDays(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	filter, err := a.orderFilter(r, p)
	if err != nil {
		return err
	}
	days, err := CountByDay(r.Context(), a.Read, filter)
	if err != nil {
		return err
	}
	waiting := ""
	switch {
	case p.Can(Manage):
		waiting = Submitted
	case p.Can(Create):
		waiting = Bumped
	}
	out := make([]transportDayDTO, 0, len(days))
	for _, d := range days {
		dto := transportDayDTO{Date: d.Date, ByStatus: d.ByStatus, MilitaryOpen: d.MilitaryOpen}
		for s, n := range d.ByStatus {
			dto.Total += n
			if Open(s) {
				dto.Open += n
			}
		}
		if waiting != "" {
			dto.Attention = d.ByStatus[waiting]
		}
		out = append(out, dto)
	}
	core.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (a *api) readTransportOrder(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Read, p, id)
	if err != nil {
		return err
	}
	var events []Event
	if p.Can(ViewAll, Manage) { // history is for staff
		if events, err = OrderEvents(r.Context(), a.Read, id); err != nil {
			return err
		}
	}
	core.WriteJSON(w, http.StatusOK, a.orderDTO(o, p, events))
	return nil
}

// stopNames reads and checks a list of stop names.
func stopNames(b *core.Body) []string {
	raw := b.StringList("stops", 10)
	out := make([]string, 0, len(raw))
	for _, s := range raw {
		s = strings.TrimSpace(s)
		if n := utf8.RuneCountInString(s); n < 1 || n > 200 {
			b.Fail("stops", "Кожна зупинка — від 1 до 200 символів", "value_error")
			break
		}
		out = append(out, s)
	}
	return out
}

// reqString reads a required text field; blanks do not count as an answer.
func reqString(b *core.Body, name string, max int) string {
	v := strings.TrimSpace(b.String(name, 1, max))
	if v == "" {
		if b.Has(name) {
			b.Fail(name, "Поле обов’язкове", "value_error")
		}
	}
	return v
}

func timeField(b *core.Body, name string) string {
	t := strings.TrimSpace(b.String(name, 1, 5))
	if t != "" && !ValidTime(t) {
		b.Fail(name, "Час має мати вигляд ГГ:ХХ", "value_error")
	}
	return t
}

// parseOrder validates a submitted order. At least one of delivery and carriers is required.
func parseOrder(r *http.Request) (Input, error) {
	body, err := core.ReadBody(r)
	if err != nil {
		return Input{}, err
	}
	in := Input{
		ServiceDate: strings.TrimSpace(body.String("service_date", 10, 10)),
		Deceased:    reqString(body, "deceased", 200),
		Notes:       strings.TrimSpace(body.OptString("notes", "", 1000)),
		Military:    body.OptBool("military", false),
	}
	if in.ServiceDate != "" && !ValidDate(in.ServiceDate) {
		body.Fail("service_date", "Дата має мати вигляд 2026-10-31", "value_error")
	}
	if d := body.Object("delivery"); d != nil {
		in.Delivery = &Delivery{
			CarNumber:   reqString(d, "car_number", 30),
			Departure:   reqString(d, "departure", 300),
			Time:        timeField(d, "time"),
			Destination: reqString(d, "destination", 300),
			Stops:       stopNames(d),
		}
	}
	if c := body.Object("carriers"); c != nil {
		n := c.Int("count", 1, false)
		if !ValidCrew(int(n)) {
			c.Fail("count", "Бригада виносу — 4 або 6 осіб", "value_error")
		}
		in.Carriers = &Carriers{
			CarNumber:      reqString(c, "car_number", 30),
			Departure:      reqString(c, "departure", 300),
			Count:          int(n),
			Time:           timeField(c, "time"),
			CemeteryNumber: reqString(c, "cemetery_number", 50),
			Stops:          stopNames(c),
		}
		if len(in.Carriers.Stops) == 0 { // the route must be in the order: a stop that was not ordered is a fault
			c.Fail("stops", "Вкажіть хоча б одну зупинку (наприклад, дім жалоби чи церкву)", "value_error")
		}
	}
	if err := body.Err(); err != nil {
		return in, err
	}
	if in.Delivery == nil && in.Carriers == nil {
		return in, core.FormError{Message: "Додайте доставку, винос або обидва пункти."}
	}
	return in, nil
}

func (a *api) createTransportOrder(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	in, err := parseOrder(r)
	if err != nil {
		return err
	}
	ip, name := a.ClientIP(r), p.DisplayName()
	var id int64
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		var err error
		if err = a.claimCars(r.Context(), tx, in, 0, p, name, ip); err != nil {
			return err
		}
		if id, err = CreateOrder(r.Context(), tx, p.Org.ID, p.ID, name, in, a.Now()); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "створено замовлення транспорту", in.Deceased+" · "+in.ServiceDate+militaryMark(in.Military)); err != nil {
			return err
		}
		title := "Нове замовлення транспорту"
		if in.Military {
			title = "Нове ВІЙСЬКОВЕ замовлення транспорту"
		}
		return a.NotifyHolders(r.Context(), tx, p.ID, 0, []string{Manage}, "transport.new", title, orderLine(p.Org.Name, in), "/admin/transport")
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Read, p, id)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, a.orderDTO(o, p, nil))
	return nil
}

var errOrderLocked = core.HTTPError{Status: 409, Detail: "Замовлення вже розглянуто диспетчером, змінити його не можна."}

func (a *api) updateTransportOrder(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	in, err := parseOrder(r)
	if err != nil {
		return err
	}
	ip, name := a.ClientIP(r), p.DisplayName()
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOwnOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if o.Status != Submitted && o.Status != Bumped {
			return errOrderLocked
		}
		if err := a.claimCars(r.Context(), tx, in, id, p, name, ip); err != nil {
			return err
		}
		if err := UpdateOrder(r.Context(), tx, id, p.ID, name, in, a.Now()); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "змінено замовлення транспорту", in.Deceased+" · "+in.ServiceDate+militaryMark(in.Military)); err != nil {
			return err
		}
		if o.Status == Bumped { // sent again after the car was taken: the dispatchers should look again
			return a.NotifyHolders(r.Context(), tx, p.ID, 0, []string{Manage}, "transport.new", "Замовлення надіслано знову", orderLine(p.Org.Name, in), "/admin/transport")
		}
		return nil
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Read, p, id)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, a.orderDTO(o, p, nil))
	return nil
}

func (a *api) cancelTransportOrder(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	ip, name := a.ClientIP(r), p.DisplayName()
	err := a.Write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOwnOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if o.Status != Submitted && o.Status != Bumped {
			return core.HTTPError{Status: 409, Detail: "Замовлення вже розглянуто диспетчером. Зв’яжіться з ним, щоб скасувати."}
		}
		if err := SetOrderStatus(r.Context(), tx, id, Cancelled, "", p.ID, name, a.Now()); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "скасовано замовлення транспорту", o.Deceased+" · "+o.ServiceDate); err != nil {
			return err
		}
		return a.NotifyHolders(r.Context(), tx, p.ID, 0, []string{Manage}, "transport.cancelled", "Замовлення скасовано",
			core.JoinNames(o.OrganisationName, o.Deceased, o.ServiceDate), "/admin/transport")
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Read, p, id)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, a.orderDTO(o, p, nil))
	return nil
}

func (a *api) setTransportOrderStatus(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	status := body.Literal("status", Accepted, InProgress, Done, Rejected)
	note := strings.TrimSpace(body.OptString("note", "", 500))
	if err := body.Err(); err != nil {
		return err
	}
	if status == Rejected && note == "" {
		return core.FormError{Message: "Вкажіть причину відмови."}
	}
	ip, name := a.ClientIP(r), p.DisplayName()
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if !CanSet(o.Status, status) {
			return core.HTTPError{Status: 409, Detail: "Цей статус не можна встановити для замовлення в поточному стані."}
		}
		if err := SetOrderStatus(r.Context(), tx, id, status, note, p.ID, name, a.Now()); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "змінено статус замовлення транспорту",
			o.OrganisationName+" · "+o.Deceased+" → "+status); err != nil {
			return err
		}
		if o.SubmittedByID == p.ID {
			return nil
		}
		return a.Notify(tx, []int64{o.SubmittedByID}, "transport.status", "Замовлення «"+o.Deceased+"»: "+statusLabel(status),
			core.JoinNames(note, o.ServiceDate), "/admin/transport")
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Read, p, id)
	if err != nil {
		return err
	}
	events, err := OrderEvents(r.Context(), a.Read, id)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, a.orderDTO(o, p, events))
	return nil
}

// setTransportBearers: the dispatcher names the men who will carry (at most the crew size ordered).
func (a *api) setTransportBearers(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	raw := body.StringList("names", 6)
	if err := body.Err(); err != nil {
		return err
	}
	names := make([]string, 0, len(raw))
	for _, n := range raw {
		n = strings.TrimSpace(n)
		if c := utf8.RuneCountInString(n); c < 1 || c > 100 {
			return core.FormError{Message: "Кожне прізвище — від 1 до 100 символів."}
		}
		names = append(names, n)
	}
	ip, name := a.ClientIP(r), p.DisplayName()
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if o.Carriers == nil {
			return core.HTTPError{Status: 409, Detail: "У замовленні немає виносу."}
		}
		if o.Status == Rejected || o.Status == Cancelled {
			return core.HTTPError{Status: 409, Detail: "Замовлення відхилено або скасовано."}
		}
		if len(names) > o.Carriers.Count {
			return core.FormError{Message: "Носіїв більше, ніж замовлено (" + strconv.Itoa(o.Carriers.Count) + ")."}
		}
		if err := SetBearers(r.Context(), tx, id, names, p.ID, name, a.Now()); err != nil {
			return err
		}
		return a.Audit(tx, ip, p, "призначено носіїв замовлення транспорту",
			o.OrganisationName+" · "+o.Deceased+" · "+strings.Join(names, ", "))
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Read, p, id)
	if err != nil {
		return err
	}
	events, err := OrderEvents(r.Context(), a.Read, id)
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, a.orderDTO(o, p, events))
	return nil
}

func militaryMark(m bool) string {
	if m {
		return " · військове"
	}
	return ""
}

// claimCars books the cars of an order (excludeID is the order itself on an edit; 0 for a new one) inside the
// writer's transaction. An ordinary order that meets an active order on the same car within CarLock is
// refused with 409. A military order refuses only when the car is already taken for the army or is out on a trip
// (in_progress); otherwise it takes the car: each order it meets is bumped, which keeps the order, drops its car
// and tells the desk (history and audit).
func (a *api) claimCars(ctx context.Context, tx *sql.Tx, in Input, excludeID int64, p *core.Caller, name, ip string) error {
	conflicts, err := FindConflicts(ctx, tx, in, excludeID)
	if err != nil || len(conflicts) == 0 {
		return err
	}
	span := func(c Conflict) string {
		return c.Start.Format("15:04") + "–" + c.Start.Add(CarLock).Format("15:04")
	}
	if !in.Military {
		c := conflicts[0]
		return core.HTTPError{Status: 409, Detail: "Авто " + c.Car + " уже зайняте: " + span(c) + " (авто тримається " + strconv.Itoa(int(CarLock.Hours())) + " год після замовлення). Оберіть інший час або авто."}
	}
	for _, c := range conflicts {
		if c.Military {
			return core.HTTPError{Status: 409, Detail: "Авто " + c.Car + " уже зайняте іншим військовим замовленням: " + span(c) + "."}
		}
		if c.Status == InProgress {
			return core.HTTPError{Status: 409, Detail: "Авто " + c.Car + " уже виконує замовлення (" + span(c) + "), зняти його не можна. Зв’яжіться з диспетчером."}
		}
	}
	for _, c := range conflicts {
		o, err := GetOrder(ctx, tx, c.OrderID)
		if err != nil {
			return err
		}
		note := "Авто знято під військове замовлення. Змініть авто чи час і надішліть замовлення знову."
		if err := Bump(ctx, tx, c.OrderID, note, p.ID, name, a.Now()); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "знято авто із замовлення транспорту",
			o.OrganisationName+" · "+o.Deceased+" · "+c.Car+" → військове замовлення"); err != nil {
			return err
		}
		if err := a.Notify(tx, []int64{o.SubmittedByID}, "transport.bumped", "Авто знято з вашого замовлення",
			core.JoinNames(o.Deceased, o.ServiceDate, "авто "+c.Car+" передано військовому замовленню"), "/admin/transport"); err != nil {
			return err
		}
	}
	return nil
}

// orderLine is the one-line summary of an order for a notification: desk, deceased, day and the earliest time.
func orderLine(org string, in Input) string {
	o := Order{Delivery: in.Delivery, Carriers: in.Carriers}
	return core.JoinNames(org, in.Deceased, in.ServiceDate+" "+o.SortTime())
}

func statusLabel(s string) string {
	switch s {
	case Accepted:
		return "прийнято"
	case InProgress:
		return "виконується"
	case Done:
		return "виконано"
	case Rejected:
		return "відхилено"
	}
	return s
}
