package transport

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"legkyi/internal/core"
)

// Order statuses. A desk sends an order (submitted); the dispatcher replies by moving it on.
const (
	Submitted  = "submitted"
	Accepted   = "accepted"
	InProgress = "in_progress"
	Done       = "done"
	Rejected   = "rejected"
	Cancelled  = "cancelled"
	// Bumped: a military order took the car. The desk keeps the order, which holds no car any more, and
	// edits it (another car or time) to send it again.
	Bumped = "bumped"
)

// ManagerNext lists the statuses a dispatcher may set from each status. done, rejected and cancelled are final.
var ManagerNext = map[string][]string{
	Submitted:  {Accepted, Rejected},
	Accepted:   {InProgress, Done, Rejected},
	InProgress: {Done, Rejected},
	Bumped:     {Rejected},
}

// CanSet reports whether a dispatcher may move an order from one status to another.
func CanSet(from, to string) bool {
	for _, s := range ManagerNext[from] {
		if s == to {
			return true
		}
	}
	return false
}

var (
	timeRE = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
	dateRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

func ValidTime(s string) bool { return timeRE.MatchString(s) }

func ValidDate(s string) bool {
	if !dateRE.MatchString(s) {
		return false
	}
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

// Delivery is the transport of the deceased: which car, from where, when and where to.
type Delivery struct {
	CarNumber, Departure string // CarNumber is the snapshot of the car's display form (or old free text)
	CarID                int64  // the fleet car, 0 = none (free text or not yet assigned)
	Time, Destination    string
	Stops                []string // optional transit stops
}

// Carriers is the bearers' part ("на плечах"): how many men, when, the transit stops on the way (for the
// ceremony: at least one) and the cemetery number at the end.
type Carriers struct {
	CarNumber, Departure string // the car that takes the coffin: the delivery's car or another one
	CarID                int64  // the fleet car, 0 = none
	Count                int    // 4 or 6 men
	Time                 string
	CemeteryNumber       string
	Stops                []string
	Bearers              []string // the men the dispatcher assigned (at most Count)
}

// ValidCrew: a crew is 4 or 6 men.
func ValidCrew(n int) bool { return n == 4 || n == 6 }

// Input is what a desk submits.
type Input struct {
	ServiceDate, Deceased, Notes string
	Military                     bool // an order for the army: it takes a car from an ordinary order
	Delivery                     *Delivery
	Carriers                     *Carriers
	SameCar                      bool // the carriers use the delivery's car (resolved when the cars are looked up)
}

// HasCars reports whether every present part has a car (a fleet car or an old free-text number).
func (o Order) HasCars() bool {
	has := func(text string, id int64) bool { return id != 0 || strings.TrimSpace(text) != "" }
	if o.Delivery != nil && !has(o.Delivery.CarNumber, o.Delivery.CarID) {
		return false
	}
	if o.Carriers != nil && !has(o.Carriers.CarNumber, o.Carriers.CarID) {
		return false
	}
	return true
}

// carIDs lists the fleet cars the order already holds (an edit may keep a car that was deactivated since).
func (o Order) carIDs() map[int64]bool {
	m := map[int64]bool{}
	if o.Delivery != nil && o.Delivery.CarID != 0 {
		m[o.Delivery.CarID] = true
	}
	if o.Carriers != nil && o.Carriers.CarID != 0 {
		m[o.Carriers.CarID] = true
	}
	return m
}

// Order is a stored order. Delivery and Carriers of one deceased live in the same order, so they are listed together.
type Order struct {
	ID, OrganisationID           int64
	OrganisationName             string
	ServiceDate, Deceased, Notes string
	Status, ReplyNote            string
	Military                     bool
	Delivery                     *Delivery
	Carriers                     *Carriers
	SubmittedByID                int64
	SubmittedByName              string
	CreatedAt, UpdatedAt         int64
	Cargo                        []CargoLine // goods this order carries to its organisation
}

// SameCar reports whether one car does both parts (they are shown as one run).
func (o Order) SameCar() bool {
	if o.Delivery == nil || o.Carriers == nil {
		return false
	}
	return NormPlate(o.Delivery.CarNumber) == NormPlate(o.Carriers.CarNumber)
}

// SortTime is the earliest time of the order; the day list is ordered by it.
func (o Order) SortTime() string {
	t := ""
	if o.Delivery != nil {
		t = o.Delivery.Time
	}
	if o.Carriers != nil && (t == "" || o.Carriers.Time < t) {
		t = o.Carriers.Time
	}
	return t
}

// Event is one line of an order's history.
type Event struct {
	ID, TS         int64
	UserName, Kind string
	Status, Note   string
	UserID         int64
}

var ErrNotFound = errors.New("transport order not found")

const orderColumns = `o.id, o.organisation_id, org.name, o.service_date, o.deceased, o.notes, o.status, o.reply_note,
	o.has_delivery, o.delivery_car, COALESCE(o.delivery_car_id, 0), o.delivery_from, o.delivery_time, o.destination,
	o.has_carriers, o.carriers_car, COALESCE(o.carriers_car_id, 0), o.carriers_from, o.carriers_count, o.carriers_time, o.cemetery_number,
	o.is_military, COALESCE(o.created_by_id, 0), o.created_by_name, o.created_at, o.updated_at`

type scanner interface{ Scan(dest ...any) error }

func scanOrder(r scanner) (Order, error) {
	var o Order
	var hasD, hasC, mil int
	var d Delivery
	var c Carriers
	err := r.Scan(&o.ID, &o.OrganisationID, &o.OrganisationName, &o.ServiceDate, &o.Deceased, &o.Notes, &o.Status, &o.ReplyNote,
		&hasD, &d.CarNumber, &d.CarID, &d.Departure, &d.Time, &d.Destination,
		&hasC, &c.CarNumber, &c.CarID, &c.Departure, &c.Count, &c.Time, &c.CemeteryNumber,
		&mil, &o.SubmittedByID, &o.SubmittedByName, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		return o, err
	}
	o.Military = mil == 1
	if hasD == 1 {
		o.Delivery = &d
	}
	if hasC == 1 {
		o.Carriers = &c
	}
	return o, nil
}

// Filter narrows ListOrders. Empty fields do not filter.
type Filter struct {
	OrganisationID int64 // 0 = all organisations
	From, To       string
	Status         string
}

// GetOrder returns one order with its stops, or ErrNotFound.
func GetOrder(ctx context.Context, q core.Querier, id int64) (Order, error) {
	row := q.QueryRowContext(ctx, `SELECT `+orderColumns+` FROM transport_orders o JOIN organisations org ON org.id = o.organisation_id WHERE o.id = ?`, id)
	o, err := scanOrder(row)
	if errors.Is(err, sql.ErrNoRows) {
		return o, ErrNotFound
	}
	if err != nil {
		return o, err
	}
	stops, err := stopsOf(ctx, q, "WHERE s.order_id = ?", id)
	if err != nil {
		return o, err
	}
	attachStops(&o, stops[o.ID])
	one := []Order{o}
	if err := attachCargo(ctx, q, one); err != nil {
		return o, err
	}
	return one[0], nil
}

type stopKey struct{ part string }

type stopRows map[int64]map[string][]string // order id -> part -> places in order

func stopsOf(ctx context.Context, q core.Querier, where string, args ...any) (stopRows, error) {
	rows, err := q.QueryContext(ctx, `SELECT s.order_id, s.part, s.place FROM transport_order_stops s `+where+` ORDER BY s.order_id, s.position, s.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := stopRows{}
	for rows.Next() {
		var id int64
		var part, place string
		if err := rows.Scan(&id, &part, &place); err != nil {
			return nil, err
		}
		if out[id] == nil {
			out[id] = map[string][]string{}
		}
		out[id][part] = append(out[id][part], place)
	}
	return out, rows.Err()
}

func attachStops(o *Order, parts map[string][]string) {
	if o.Delivery != nil {
		o.Delivery.Stops = append([]string{}, parts["delivery"]...)
	}
	if o.Carriers != nil {
		o.Carriers.Stops = append([]string{}, parts["carriers"]...)
		o.Carriers.Bearers = append([]string{}, parts["bearers"]...)
	}
}

// ListOrders returns orders ordered by day, then by the earliest time of each order, then by id.
func ListOrders(ctx context.Context, q core.Querier, f Filter) ([]Order, error) {
	var where []string
	var args []any
	if f.OrganisationID != 0 {
		where = append(where, "o.organisation_id = ?")
		args = append(args, f.OrganisationID)
	}
	if f.From != "" {
		where = append(where, "o.service_date >= ?")
		args = append(args, f.From)
	}
	if f.To != "" {
		where = append(where, "o.service_date <= ?")
		args = append(args, f.To)
	}
	if f.Status != "" {
		where = append(where, "o.status = ?")
		args = append(args, f.Status)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := q.QueryContext(ctx, `SELECT `+orderColumns+` FROM transport_orders o JOIN organisations org ON org.id = o.organisation_id`+clause, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	stops, err := stopsOf(ctx, q, "JOIN transport_orders o ON o.id = s.order_id"+clause, args...)
	if err != nil {
		return nil, err
	}
	for i := range out {
		attachStops(&out[i], stops[out[i].ID])
	}
	if err := attachCargo(ctx, q, out); err != nil {
		return nil, err
	}
	sortChronologically(out)
	return out, nil
}

// groupKey ties together the orders of one deceased from one organisation on one day: a desk that adds the
// missing part after the dispatcher has replied has to place a second order, which must stay next to the first.
func groupKey(o Order) string {
	name := strings.Join(strings.Fields(strings.ToLower(o.Deceased)), " ")
	return o.ServiceDate + "\x00" + strconv.FormatInt(o.OrganisationID, 10) + "\x00" + name
}

// sortChronologically orders by day, then by the earliest time of each deceased's group, keeping the orders of
// one group together (earliest first), then by id.
func sortChronologically(out []Order) {
	first := map[string]string{}
	for _, o := range out {
		k := groupKey(o)
		if t, ok := first[k]; !ok || (o.SortTime() != "" && o.SortTime() < t) {
			first[k] = o.SortTime()
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.ServiceDate != b.ServiceDate {
			return a.ServiceDate < b.ServiceDate
		}
		ka, kb := groupKey(a), groupKey(b)
		if ka != kb {
			if ta, tb := first[ka], first[kb]; ta != tb {
				return ta < tb
			}
			return ka < kb
		}
		if ta, tb := a.SortTime(), b.SortTime(); ta != tb {
			return ta < tb
		}
		return a.ID < b.ID
	})
}

// OrderEvents returns the history of one order, oldest first.
func OrderEvents(ctx context.Context, q core.Querier, id int64) ([]Event, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, ts, COALESCE(user_id, 0), user_name, kind, status, note FROM transport_order_events WHERE order_id = ? ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.TS, &e.UserID, &e.UserName, &e.Kind, &e.Status, &e.Note); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func writeParts(ctx context.Context, tx *sql.Tx, id int64, in Input) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM transport_order_stops WHERE order_id = ? AND part IN ('delivery', 'carriers')", id); err != nil {
		return err
	}
	add := func(part string, places []string) error {
		for i, p := range places {
			if _, err := tx.ExecContext(ctx, "INSERT INTO transport_order_stops (order_id, part, position, place) VALUES (?, ?, ?, ?)", id, part, i, p); err != nil {
				return err
			}
		}
		return nil
	}
	if in.Delivery != nil {
		if err := add("delivery", in.Delivery.Stops); err != nil {
			return err
		}
	}
	if in.Carriers != nil {
		if err := add("carriers", in.Carriers.Stops); err != nil {
			return err
		}
	}
	return nil
}

func partArgs(in Input) []any {
	var d Delivery
	var c Carriers
	if in.Delivery != nil {
		d = *in.Delivery
	}
	if in.Carriers != nil {
		c = *in.Carriers
	}
	return []any{in.ServiceDate, in.Deceased, in.Notes,
		b2i(in.Delivery != nil), d.CarNumber, nullID(d.CarID), d.Departure, d.Time, d.Destination,
		b2i(in.Carriers != nil), c.CarNumber, nullID(c.CarID), c.Departure, c.Count, c.Time, c.CemeteryNumber, b2i(in.Military)}
}

// nullID stores 0 as NULL (no fleet car).
func nullID(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}

func addEvent(ctx context.Context, tx *sql.Tx, id int64, now time.Time, userID int64, userName, kind, status, note string) error {
	_, err := tx.ExecContext(ctx, "INSERT INTO transport_order_events (order_id, ts, user_id, user_name, kind, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
		id, now.Unix(), userID, userName, kind, status, note)
	return err
}

// CreateOrder stores a new order of the organisation, signed by the submitting employee.
func CreateOrder(ctx context.Context, tx *sql.Tx, orgID, userID int64, userName string, in Input, now time.Time) (int64, error) {
	args := append(partArgs(in), orgID, Submitted, userID, userName, now.Unix(), now.Unix())
	res, err := tx.ExecContext(ctx, `INSERT INTO transport_orders
		(service_date, deceased, notes, has_delivery, delivery_car, delivery_car_id, delivery_from, delivery_time, destination,
		 has_carriers, carriers_car, carriers_car_id, carriers_from, carriers_count, carriers_time, cemetery_number, is_military,
		 organisation_id, status, created_by_id, created_by_name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args...)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	if err := writeParts(ctx, tx, id, in); err != nil {
		return 0, err
	}
	return id, addEvent(ctx, tx, id, now, userID, userName, "created", Submitted, "")
}

// UpdateOrder replaces the content of an order (the caller checks that it may still be edited).
func UpdateOrder(ctx context.Context, tx *sql.Tx, id, userID int64, userName string, in Input, now time.Time) error {
	args := append(partArgs(in), now.Unix(), id)
	if _, err := tx.ExecContext(ctx, `UPDATE transport_orders SET
		service_date = ?, deceased = ?, notes = ?, has_delivery = ?, delivery_car = ?, delivery_car_id = ?, delivery_from = ?, delivery_time = ?, destination = ?,
		has_carriers = ?, carriers_car = ?, carriers_car_id = ?, carriers_from = ?, carriers_count = ?, carriers_time = ?, cemetery_number = ?, is_military = ?, updated_at = ? WHERE id = ?`, args...); err != nil {
		return err
	}
	if err := writeParts(ctx, tx, id, in); err != nil {
		return err
	}
	// Assigned men survive an edit, but not more than the (possibly smaller) crew, and not without carriers.
	keep := 0
	if in.Carriers != nil {
		keep = in.Carriers.Count
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM transport_order_stops WHERE order_id = ? AND part = 'bearers' AND position >= ?", id, keep); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE transport_orders SET status = ? WHERE id = ? AND status = ?", Submitted, id, Bumped); err != nil {
		return err
	}
	return addEvent(ctx, tx, id, now, userID, userName, "edited", "", "")
}

// SetOrderStatus records a new status with the reply note shown to the desk.
func SetOrderStatus(ctx context.Context, tx *sql.Tx, id int64, status, note string, userID int64, userName string, now time.Time) error {
	// An empty note keeps the previous reply the desk is reading ("Авто виїде о 8:40" stays after "Виїхали");
	// the history event below records exactly what was entered.
	if _, err := tx.ExecContext(ctx, "UPDATE transport_orders SET status = ?, reply_note = CASE WHEN ? = '' THEN reply_note ELSE ? END, updated_at = ? WHERE id = ?",
		status, note, note, now.Unix(), id); err != nil {
		return err
	}
	return addEvent(ctx, tx, id, now, userID, userName, "status", status, note)
}

// SetBearers replaces the men the dispatcher assigned to the carriers part (the caller checks the count).
func SetBearers(ctx context.Context, tx *sql.Tx, id int64, names []string, userID int64, userName string, now time.Time) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM transport_order_stops WHERE order_id = ? AND part = 'bearers'", id); err != nil {
		return err
	}
	for i, n := range names {
		if _, err := tx.ExecContext(ctx, "INSERT INTO transport_order_stops (order_id, part, position, place) VALUES (?, 'bearers', ?, ?)", id, i, n); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "UPDATE transport_orders SET updated_at = ? WHERE id = ?", now.Unix(), id); err != nil {
		return err
	}
	return addEvent(ctx, tx, id, now, userID, userName, "bearers", "", strings.Join(names, ", "))
}

// Open reports whether an order is still being worked on (not done, rejected or cancelled). An order for a
// day a week away stays open the whole week: the date strip and the reminders must not lose it.
func Open(status string) bool {
	switch status {
	case Submitted, Accepted, InProgress, Bumped:
		return true
	}
	return false
}

// DayCount is how many orders of one day are in each status.
type DayCount struct {
	Date         string
	ByStatus     map[string]int
	MilitaryOpen int // open military orders of the day
}

// CountByDay counts the orders of each day in the filter (Status is ignored), ordered by day. Days without
// orders are left out.
func CountByDay(ctx context.Context, q core.Querier, f Filter) ([]DayCount, error) {
	var where []string
	var args []any
	if f.OrganisationID != 0 {
		where = append(where, "organisation_id = ?")
		args = append(args, f.OrganisationID)
	}
	if f.From != "" {
		where = append(where, "service_date >= ?")
		args = append(args, f.From)
	}
	if f.To != "" {
		where = append(where, "service_date <= ?")
		args = append(args, f.To)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := q.QueryContext(ctx, `SELECT service_date, status, is_military, COUNT(*) FROM transport_orders`+clause+` GROUP BY service_date, status, is_military ORDER BY service_date`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DayCount{}
	for rows.Next() {
		var day, status string
		var mil, n int
		if err := rows.Scan(&day, &status, &mil, &n); err != nil {
			return nil, err
		}
		if len(out) == 0 || out[len(out)-1].Date != day {
			out = append(out, DayCount{Date: day, ByStatus: map[string]int{}})
		}
		out[len(out)-1].ByStatus[status] += n
		if mil == 1 && Open(status) {
			out[len(out)-1].MilitaryOpen += n
		}
	}
	return out, rows.Err()
}

// SetAssignment stores the car, time and stops the dispatcher chose for the parts present in o (the other columns
// stay as they are) and writes the history line. A bumped order that gets a car goes back to submitted, like an
// edit by the desk, so the dispatcher can accept it.
func SetAssignment(ctx context.Context, tx *sql.Tx, o Order, userID int64, userName, note string, now time.Time) error {
	if o.Delivery != nil {
		if _, err := tx.ExecContext(ctx, "UPDATE transport_orders SET delivery_car = ?, delivery_car_id = ?, delivery_time = ? WHERE id = ?",
			o.Delivery.CarNumber, nullID(o.Delivery.CarID), o.Delivery.Time, o.ID); err != nil {
			return err
		}
	}
	if o.Carriers != nil {
		if _, err := tx.ExecContext(ctx, "UPDATE transport_orders SET carriers_car = ?, carriers_car_id = ?, carriers_time = ? WHERE id = ?",
			o.Carriers.CarNumber, nullID(o.Carriers.CarID), o.Carriers.Time, o.ID); err != nil {
			return err
		}
	}
	if err := writeParts(ctx, tx, o.ID, Input{Delivery: o.Delivery, Carriers: o.Carriers}); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE transport_orders SET updated_at = ? WHERE id = ?", now.Unix(), o.ID); err != nil {
		return err
	}
	if err := addEvent(ctx, tx, o.ID, now, userID, userName, "assignment", "", note); err != nil {
		return err
	}
	if o.Status == Bumped {
		if _, err := tx.ExecContext(ctx, "UPDATE transport_orders SET status = ? WHERE id = ?", Submitted, o.ID); err != nil {
			return err
		}
		return addEvent(ctx, tx, o.ID, now, userID, userName, "status", Submitted, "")
	}
	return nil
}
