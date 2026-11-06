package web

import (
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
	Time        string   `json:"time"`
	Destination string   `json:"destination"`
	Stops       []string `json:"stops"`
}

type carriersDTO struct {
	Count          int      `json:"count"`
	Time           string   `json:"time"`
	From           string   `json:"from"`
	CemeteryNumber string   `json:"cemetery_number"`
	Stops          []string `json:"stops"`
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
	rt.Handle("POST", "/transport/orders/{oid}/status", a.authed([]string{transport.Manage}, a.setTransportOrderStatus))
}

// seesAll: staff (platform users holding view_all or manage) see every organisation's orders; an
// organisation's employees only their own.
func seesAll(p *platform.Principal) bool {
	return p.User.Org == nil && p.Can(transport.ViewAll, transport.Manage)
}

func (a *App) orderDTO(o transport.Order, p *platform.Principal, events []transport.Event) transportOrderDTO {
	d := transportOrderDTO{
		ID: o.ID, Organisation: organisationRef{o.OrganisationID, o.OrganisationName},
		ServiceDate: o.ServiceDate, Deceased: o.Deceased, Notes: o.Notes, Status: o.Status, ReplyNote: o.ReplyNote,
		SortTime: o.SortTime(), SubmittedBy: o.SubmittedByName,
		CreatedAt: servedTimeOf(time.Unix(o.CreatedAt, 0)), UpdatedAt: servedTimeOf(time.Unix(o.UpdatedAt, 0)),
		CanEdit:      p.User.Org != nil && o.Status == transport.Submitted && p.Can(transport.Create),
		NextStatuses: []string{}, Events: []orderEventDTO{},
	}
	if o.Delivery != nil {
		d.Delivery = &deliveryDTO{o.Delivery.CarNumber, o.Delivery.Time, o.Delivery.Destination, o.Delivery.Stops}
	}
	if o.Carriers != nil {
		d.Carriers = &carriersDTO{o.Carriers.Count, o.Carriers.Time, o.Carriers.From, o.Carriers.CemeteryNumber, o.Carriers.Stops}
	}
	if p.Can(transport.Manage) {
		d.NextStatuses = append(d.NextStatuses, transport.ManagerNext[o.Status]...)
	}
	for _, e := range events {
		d.Events = append(d.Events, orderEventDTO{servedTimeOf(time.Unix(e.TS, 0)), e.UserName, e.Kind, e.Status, e.Note})
	}
	return d
}

// loadOrder resolves an order the caller may see; other organisations' orders answer 404.
func (a *App) loadOrder(r *http.Request, q core.Querier, p *platform.Principal, id int64) (transport.Order, error) {
	o, err := transport.GetOrder(r.Context(), q, id)
	if errors.Is(err, transport.ErrNotFound) || (err == nil && !seesAll(p) && (p.User.Org == nil || o.OrganisationID != p.User.Org.ID)) {
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
		Deceased:    strings.TrimSpace(body.String("deceased", 1, 200)),
		Notes:       strings.TrimSpace(body.OptString("notes", "", 1000)),
	}
	if in.ServiceDate != "" && !transport.ValidDate(in.ServiceDate) {
		body.fail("service_date", "Дата має мати вигляд 2026-10-31", "value_error")
	}
	if d := body.Object("delivery"); d != nil {
		in.Delivery = &transport.Delivery{
			CarNumber:   strings.TrimSpace(d.String("car_number", 1, 30)),
			Time:        timeField(d, "time"),
			Destination: strings.TrimSpace(d.String("destination", 1, 300)),
			Stops:       stopsOf(d),
		}
	}
	if c := body.Object("carriers"); c != nil {
		n := c.Int("count", 1, false)
		if n > 50 {
			c.fail("count", "Input should be less than or equal to 50", "less_than_equal")
		}
		in.Carriers = &transport.Carriers{
			Count:          int(n),
			Time:           timeField(c, "time"),
			From:           strings.TrimSpace(c.String("from", 1, 300)),
			CemeteryNumber: strings.TrimSpace(c.OptString("cemetery_number", "", 50)),
			Stops:          stopsOf(c),
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
		if id, err = transport.CreateOrder(r.Context(), tx, p.User.Org.ID, p.User.ID, name, in, a.now()); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "створено замовлення транспорту", in.Deceased+" · "+in.ServiceDate)
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
		o, err := a.loadOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if o.Status != transport.Submitted {
			return errOrderLocked
		}
		if err := transport.UpdateOrder(r.Context(), tx, id, p.User.ID, name, in, a.now()); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено замовлення транспорту", in.Deceased+" · "+in.ServiceDate)
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
		o, err := a.loadOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if o.Status != transport.Submitted {
			return HTTPError{Status: 409, Detail: "Замовлення вже розглянуто диспетчером. Зв’яжіться з ним, щоб скасувати."}
		}
		if err := transport.SetOrderStatus(r.Context(), tx, id, transport.Cancelled, "", p.User.ID, name, a.now()); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "скасовано замовлення транспорту", o.Deceased+" · "+o.ServiceDate)
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
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "змінено статус замовлення транспорту",
			o.OrganisationName+" · "+o.Deceased+" → "+status)
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
