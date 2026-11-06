package web

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"legkyi/internal/core"
	"legkyi/internal/platform"
	"legkyi/internal/transport"
)

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
	Organisation organisationRef `json:"organisation"`
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

// displayName is how an employee signs what they submit: the full name, else the login.
func displayName(u platform.User) string {
	if n := strings.TrimSpace(u.FullName); n != "" {
		return n
	}
	return u.Login
}

func (a *App) mountTransport(rt *Router) {
	anyCode := []string{transport.Create, transport.ViewAll, transport.Manage}
	create := []string{transport.Create}
	rt.Handle("GET", "/transport/status", a.authed(anyCode, func(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
		writeJSON(w, http.StatusOK, transportStatusDTO{true, "Замовлення транспорту: створюйте записи на день і стежте за відповіддю диспетчера."})
		return nil
	}))
	rt.Handle("GET", "/transport/orders", a.authed(anyCode, a.listTransportOrders))
	rt.Handle("GET", "/transport/orders/{oid}", a.authed(anyCode, a.readTransportOrder))
	rt.Handle("POST", "/transport/orders", a.member(create, a.createTransportOrder))
	rt.Handle("PUT", "/transport/orders/{oid}", a.member(create, a.updateTransportOrder))
	rt.Handle("POST", "/transport/orders/{oid}/cancel", a.member(create, a.cancelTransportOrder))
	rt.Handle("PUT", "/transport/orders/{oid}/bearers", a.authed([]string{transport.Manage}, a.setTransportBearers))
	rt.Handle("POST", "/transport/orders/{oid}/status", a.authed([]string{transport.Manage}, a.setTransportOrderStatus))
}

// seesAll: whoever holds view_all or manage sees every division's orders (a dispatcher may belong to a division
// or to none); everyone else only their own division's.
func seesAll(p *platform.Principal) bool {
	return p.Can(transport.ViewAll, transport.Manage)
}

func (a *App) orderDTO(o transport.Order, p *platform.Principal, events []transport.Event) transportOrderDTO {
	d := transportOrderDTO{
		ID: o.ID, Organisation: organisationRef{o.OrganisationID, o.OrganisationName},
		ServiceDate: o.ServiceDate, Deceased: o.Deceased, Notes: o.Notes, SameCar: o.SameCar(), Military: o.Military, Status: o.Status, ReplyNote: o.ReplyNote,
		SortTime: o.SortTime(), SubmittedBy: o.SubmittedByName,
		CreatedAt: servedTimeOf(time.Unix(o.CreatedAt, 0)), UpdatedAt: servedTimeOf(time.Unix(o.UpdatedAt, 0)),
		CanEdit:      p.User.Org != nil && (o.Status == transport.Submitted || o.Status == transport.Bumped) && p.Can(transport.Create),
		NextStatuses: []string{}, Events: []orderEventDTO{},
	}
	if o.Delivery != nil {
		d.Delivery = &deliveryDTO{o.Delivery.CarNumber, o.Delivery.Departure, o.Delivery.Time, o.Delivery.Destination, o.Delivery.Stops}
	}
	if o.Carriers != nil {
		d.Carriers = &carriersDTO{o.Carriers.CarNumber, o.Carriers.Departure, o.Carriers.Count, o.Carriers.Time, o.Carriers.CemeteryNumber, o.Carriers.Stops, o.Carriers.Bearers}
	}
	if p.Can(transport.Manage) {
		d.NextStatuses = append(d.NextStatuses, transport.ManagerNext[o.Status]...)
	}
	for _, e := range events {
		d.Events = append(d.Events, orderEventDTO{servedTimeOf(time.Unix(e.TS, 0)), e.UserName, e.Kind, e.Status, e.Note})
	}
	return d
}

// loadOrder resolves an order the caller may see; other divisions' orders answer 404 unless the caller may
// see every division's orders.
func (a *App) loadOrder(r *http.Request, q core.Querier, p *platform.Principal, id int64) (transport.Order, error) {
	return a.findOrder(r, q, p, id, seesAll(p))
}

// loadOwnOrder resolves an order of the caller's own division only. Editing and cancelling use it: seeing every
// division's orders (manage, view_all) never lets someone rewrite another division's order.
func (a *App) loadOwnOrder(r *http.Request, q core.Querier, p *platform.Principal, id int64) (transport.Order, error) {
	return a.findOrder(r, q, p, id, false)
}

func (a *App) findOrder(r *http.Request, q core.Querier, p *platform.Principal, id int64, all bool) (transport.Order, error) {
	o, err := transport.GetOrder(r.Context(), q, id)
	if errors.Is(err, transport.ErrNotFound) || (err == nil && !all && (p.User.Org == nil || o.OrganisationID != p.User.Org.ID)) {
		return o, HTTPError{Status: 404, Detail: "Замовлення не знайдено."}
	}
	return o, err
}

func (a *App) today() string { return a.now().In(time.Local).Format("2006-01-02") }

func (a *App) listTransportOrders(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	date, from, to := pm.String("date"), pm.String("from"), pm.String("to")
	status := pm.String("status")
	org := pm.OptInt("organisation_id")
	if err := pm.Err(); err != nil {
		return err
	}
	if date == "" && from == "" && to == "" {
		date = a.today()
	}
	if date == "" && (from == "" || to == "") {
		return HTTPError{Status: 400, Detail: "Вкажіть обидві дати діапазону: from і to."}
	}
	if date != "" {
		from, to = date, date
	}
	for _, v := range []string{from, to} {
		if v != "" && !transport.ValidDate(v) {
			return HTTPError{Status: 400, Detail: "Дата має мати вигляд 2026-10-31"}
		}
	}
	if from != "" && to != "" {
		f, _ := time.Parse("2006-01-02", from)
		t, _ := time.Parse("2006-01-02", to)
		if t.Before(f) || t.Sub(f) > 400*24*time.Hour {
			return HTTPError{Status: 400, Detail: "Некоректний діапазон дат."}
		}
	}
	filter := transport.Filter{From: from, To: to, Status: status}
	switch {
	case !seesAll(p):
		if p.User.Org == nil {
			return HTTPError{Status: 403, Detail: "Недостатньо прав для цієї дії."}
		}
		filter.OrganisationID = p.User.Org.ID
	case org != nil:
		filter.OrganisationID = *org
	}
	orders, err := transport.ListOrders(r.Context(), a.Store.R, filter)
	if err != nil {
		return err
	}
	out := make([]transportOrderDTO, 0, len(orders))
	for _, o := range orders {
		out = append(out, a.orderDTO(o, p, nil))
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) readTransportOrder(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Store.R, p, id)
	if err != nil {
		return err
	}
	var events []transport.Event
	if p.Can(transport.ViewAll, transport.Manage) { // history is for staff
		if events, err = transport.OrderEvents(r.Context(), a.Store.R, id); err != nil {
			return err
		}
	}
	writeJSON(w, http.StatusOK, a.orderDTO(o, p, events))
	return nil
}

// stopsOf reads and checks a list of stop names.
func stopsOf(b *Body) []string {
	raw := b.StringList("stops", 10)
	out := make([]string, 0, len(raw))
	for _, s := range raw {
		s = strings.TrimSpace(s)
		if n := utf8.RuneCountInString(s); n < 1 || n > 200 {
			b.fail("stops", "Кожна зупинка — від 1 до 200 символів", "value_error")
			break
		}
		out = append(out, s)
	}
	return out
}

// reqString reads a required text field; blanks do not count as an answer.
func reqString(b *Body, name string, max int) string {
	v := strings.TrimSpace(b.String(name, 1, max))
	if v == "" {
		if _, present := b.fields[name]; present {
			b.fail(name, "Поле обов’язкове", "value_error")
		}
	}
	return v
}

func timeField(b *Body, name string) string {
	t := strings.TrimSpace(b.String(name, 1, 5))
	if t != "" && !transport.ValidTime(t) {
		b.fail(name, "Час має мати вигляд ГГ:ХХ", "value_error")
	}
	return t
}

// parseOrder validates a submitted order. At least one of delivery and carriers is required.
func parseOrder(r *http.Request) (transport.Input, error) {
	body, err := ReadBody(r)
	if err != nil {
		return transport.Input{}, err
	}
	in := transport.Input{
		ServiceDate: strings.TrimSpace(body.String("service_date", 10, 10)),
		Deceased:    reqString(body, "deceased", 200),
		Notes:       strings.TrimSpace(body.OptString("notes", "", 1000)),
		Military:    body.OptBool("military", false),
	}
	if in.ServiceDate != "" && !transport.ValidDate(in.ServiceDate) {
		body.fail("service_date", "Дата має мати вигляд 2026-10-31", "value_error")
	}
	if d := body.Object("delivery"); d != nil {
		in.Delivery = &transport.Delivery{
			CarNumber:   reqString(d, "car_number", 30),
			Departure:   reqString(d, "departure", 300),
			Time:        timeField(d, "time"),
			Destination: reqString(d, "destination", 300),
			Stops:       stopsOf(d),
		}
	}
	if c := body.Object("carriers"); c != nil {
		n := c.Int("count", 1, false)
		if !transport.ValidCrew(int(n)) {
			c.fail("count", "Бригада виносу — 4 або 6 осіб", "value_error")
		}
		in.Carriers = &transport.Carriers{
			CarNumber:      reqString(c, "car_number", 30),
			Departure:      reqString(c, "departure", 300),
			Count:          int(n),
			Time:           timeField(c, "time"),
			CemeteryNumber: reqString(c, "cemetery_number", 50),
			Stops:          stopsOf(c),
		}
		if len(in.Carriers.Stops) == 0 { // the route must be in the order: a stop that was not ordered is a fault
			c.fail("stops", "Вкажіть хоча б одну зупинку (наприклад, дім жалоби чи церкву)", "value_error")
		}
	}
	if err := body.Err(); err != nil {
		return in, err
	}
	if in.Delivery == nil && in.Carriers == nil {
		return in, FormError{"Додайте доставку, винос або обидва пункти."}
	}
	return in, nil
}

func (a *App) createTransportOrder(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	in, err := parseOrder(r)
	if err != nil {
		return err
	}
	ip, name := a.Trusted.ClientIP(r), displayName(p.User)
	var id int64
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		var err error
		if err = a.claimCars(r.Context(), tx, in, 0, p, name, ip); err != nil {
			return err
		}
		if id, err = transport.CreateOrder(r.Context(), tx, p.User.Org.ID, p.User.ID, name, in, a.now()); err != nil {
			return err
		}
		if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "створено замовлення транспорту", in.Deceased+" · "+in.ServiceDate+militaryMark(in.Military)); err != nil {
			return err
		}
		title := "Нове замовлення транспорту"
		if in.Military {
			title = "Нове ВІЙСЬКОВЕ замовлення транспорту"
		}
		return a.notifyHolders(r.Context(), tx, p.User.ID, 0, []string{transport.Manage}, "transport.new", title, orderLine(p.User.Org.Name, in), "/admin/transport")
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Store.R, p, id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, a.orderDTO(o, p, nil))
	return nil
}

var errOrderLocked = HTTPError{Status: 409, Detail: "Замовлення вже розглянуто диспетчером, змінити його не можна."}

func (a *App) updateTransportOrder(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	in, err := parseOrder(r)
	if err != nil {
		return err
	}
	ip, name := a.Trusted.ClientIP(r), displayName(p.User)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOwnOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if o.Status != transport.Submitted && o.Status != transport.Bumped {
			return errOrderLocked
		}
		if err := a.claimCars(r.Context(), tx, in, id, p, name, ip); err != nil {
			return err
		}
		if err := transport.UpdateOrder(r.Context(), tx, id, p.User.ID, name, in, a.now()); err != nil {
			return err
		}
		if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено замовлення транспорту", in.Deceased+" · "+in.ServiceDate+militaryMark(in.Military)); err != nil {
			return err
		}
		if o.Status == transport.Bumped { // sent again after the car was taken: the dispatchers should look again
			return a.notifyHolders(r.Context(), tx, p.User.ID, 0, []string{transport.Manage}, "transport.new", "Замовлення надіслано знову", orderLine(p.User.Org.Name, in), "/admin/transport")
		}
		return nil
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Store.R, p, id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, a.orderDTO(o, p, nil))
	return nil
}

func (a *App) cancelTransportOrder(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	ip, name := a.Trusted.ClientIP(r), displayName(p.User)
	err := a.write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOwnOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if o.Status != transport.Submitted && o.Status != transport.Bumped {
			return HTTPError{Status: 409, Detail: "Замовлення вже розглянуто диспетчером. Зв’яжіться з ним, щоб скасувати."}
		}
		if err := transport.SetOrderStatus(r.Context(), tx, id, transport.Cancelled, "", p.User.ID, name, a.now()); err != nil {
			return err
		}
		if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "скасовано замовлення транспорту", o.Deceased+" · "+o.ServiceDate); err != nil {
			return err
		}
		return a.notifyHolders(r.Context(), tx, p.User.ID, 0, []string{transport.Manage}, "transport.cancelled", "Замовлення скасовано",
			platform.JoinNames(o.OrganisationName, o.Deceased, o.ServiceDate), "/admin/transport")
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Store.R, p, id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, a.orderDTO(o, p, nil))
	return nil
}

func (a *App) setTransportOrderStatus(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	status := body.Literal("status", transport.Accepted, transport.InProgress, transport.Done, transport.Rejected)
	note := strings.TrimSpace(body.OptString("note", "", 500))
	if err := body.Err(); err != nil {
		return err
	}
	if status == transport.Rejected && note == "" {
		return FormError{"Вкажіть причину відмови."}
	}
	ip, name := a.Trusted.ClientIP(r), displayName(p.User)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if !transport.CanSet(o.Status, status) {
			return HTTPError{Status: 409, Detail: "Цей статус не можна встановити для замовлення в поточному стані."}
		}
		if err := transport.SetOrderStatus(r.Context(), tx, id, status, note, p.User.ID, name, a.now()); err != nil {
			return err
		}
		if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено статус замовлення транспорту",
			o.OrganisationName+" · "+o.Deceased+" → "+status); err != nil {
			return err
		}
		if o.SubmittedByID == p.User.ID {
			return nil
		}
		return a.notify(tx, []int64{o.SubmittedByID}, "transport.status", "Замовлення «"+o.Deceased+"»: "+statusLabel(status),
			platform.JoinNames(note, o.ServiceDate), "/admin/transport")
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Store.R, p, id)
	if err != nil {
		return err
	}
	events, err := transport.OrderEvents(r.Context(), a.Store.R, id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, a.orderDTO(o, p, events))
	return nil
}

// setTransportBearers: the dispatcher names the men who will carry (at most the crew size ordered).
func (a *App) setTransportBearers(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := ReadBody(r)
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
			return FormError{"Кожне прізвище — від 1 до 100 символів."}
		}
		names = append(names, n)
	}
	ip, name := a.Trusted.ClientIP(r), displayName(p.User)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if o.Carriers == nil {
			return HTTPError{Status: 409, Detail: "У замовленні немає виносу."}
		}
		if o.Status == transport.Rejected || o.Status == transport.Cancelled {
			return HTTPError{Status: 409, Detail: "Замовлення відхилено або скасовано."}
		}
		if len(names) > o.Carriers.Count {
			return FormError{"Носіїв більше, ніж замовлено (" + itoa(o.Carriers.Count) + ")."}
		}
		if err := transport.SetBearers(r.Context(), tx, id, names, p.User.ID, name, a.now()); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "призначено носіїв замовлення транспорту",
			o.OrganisationName+" · "+o.Deceased+" · "+strings.Join(names, ", "))
	})
	if err != nil {
		return err
	}
	o, err := a.loadOrder(r, a.Store.R, p, id)
	if err != nil {
		return err
	}
	events, err := transport.OrderEvents(r.Context(), a.Store.R, id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, a.orderDTO(o, p, events))
	return nil
}

func militaryMark(m bool) string {
	if m {
		return " · військове"
	}
	return ""
}

// claimCars books the cars of an order (excludeID is the order itself on an edit; 0 for a new one) inside the
// writer's transaction. An ordinary order that meets an active order on the same car within transport.CarLock is
// refused with 409. A military order refuses only when the car is already taken for the army or is out on a trip
// (in_progress); otherwise it takes the car: each order it meets is bumped, which keeps the order, drops its car
// and tells the desk (history and audit).
func (a *App) claimCars(ctx context.Context, tx *sql.Tx, in transport.Input, excludeID int64, p *platform.Principal, name, ip string) error {
	conflicts, err := transport.FindConflicts(ctx, tx, in, excludeID)
	if err != nil || len(conflicts) == 0 {
		return err
	}
	span := func(c transport.Conflict) string {
		return c.Start.Format("15:04") + "–" + c.Start.Add(transport.CarLock).Format("15:04")
	}
	if !in.Military {
		c := conflicts[0]
		return HTTPError{Status: 409, Detail: "Авто " + c.Car + " уже зайняте: " + span(c) + " (авто тримається " + itoa(int(transport.CarLock.Hours())) + " год після замовлення). Оберіть інший час або авто."}
	}
	for _, c := range conflicts {
		if c.Military {
			return HTTPError{Status: 409, Detail: "Авто " + c.Car + " уже зайняте іншим військовим замовленням: " + span(c) + "."}
		}
		if c.Status == transport.InProgress {
			return HTTPError{Status: 409, Detail: "Авто " + c.Car + " уже виконує замовлення (" + span(c) + "), зняти його не можна. Зв’яжіться з диспетчером."}
		}
	}
	for _, c := range conflicts {
		o, err := transport.GetOrder(ctx, tx, c.OrderID)
		if err != nil {
			return err
		}
		note := "Авто знято під військове замовлення. Змініть авто чи час і надішліть замовлення знову."
		if err := transport.Bump(ctx, tx, c.OrderID, note, p.User.ID, name, a.now()); err != nil {
			return err
		}
		if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "знято авто із замовлення транспорту",
			o.OrganisationName+" · "+o.Deceased+" · "+c.Car+" → військове замовлення"); err != nil {
			return err
		}
		if err := a.notify(tx, []int64{o.SubmittedByID}, "transport.bumped", "Авто знято з вашого замовлення",
			platform.JoinNames(o.Deceased, o.ServiceDate, "авто "+c.Car+" передано військовому замовленню"), "/admin/transport"); err != nil {
			return err
		}
	}
	return nil
}

// orderLine is the one-line summary of an order for a notification: desk, deceased, day and the earliest time.
func orderLine(org string, in transport.Input) string {
	o := transport.Order{Delivery: in.Delivery, Carriers: in.Carriers}
	return platform.JoinNames(org, in.Deceased, in.ServiceDate+" "+o.SortTime())
}

func statusLabel(s string) string {
	switch s {
	case transport.Accepted:
		return "прийнято"
	case transport.InProgress:
		return "виконується"
	case transport.Done:
		return "виконано"
	case transport.Rejected:
		return "відхилено"
	}
	return s
}
