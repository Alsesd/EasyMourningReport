package transport

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"sort"
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
)

// ManagerNext lists the statuses a dispatcher may set from each status. done, rejected and cancelled are final.
var ManagerNext = map[string][]string{
	Submitted:  {Accepted, Rejected},
	Accepted:   {InProgress, Done, Rejected},
	InProgress: {Done, Rejected},
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

// Delivery is the transport of the deceased: which car, when, where to.
type Delivery struct {
	CarNumber, Time, Destination string
	Stops                        []string
}

// Carriers is the bearers' part ("на плечах"): how many men, when and from where, the cemetery, and the
// transit stops (for the ceremony) on the way.
type Carriers struct {
	Count          int
	Time, From     string
	CemeteryNumber string
	Stops          []string
}

// Input is what a desk submits.
type Input struct {
	ServiceDate, Deceased, Notes string
	Delivery                     *Delivery
	Carriers                     *Carriers
}

// Order is a stored order. Delivery and Carriers of one deceased live in the same order, so they are listed together.
type Order struct {
	ID, OrganisationID           int64
	OrganisationName             string
	ServiceDate, Deceased, Notes string
	Status, ReplyNote            string
	Delivery                     *Delivery
	Carriers                     *Carriers
	SubmittedByID                int64
	SubmittedByName              string
	CreatedAt, UpdatedAt         int64
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
	o.has_delivery, o.car_number, o.delivery_time, o.destination,
	o.has_carriers, o.carriers_count, o.carriers_time, o.carriers_from, o.cemetery_number,
	COALESCE(o.created_by_id, 0), o.created_by_name, o.created_at, o.updated_at`

type scanner interface{ Scan(dest ...any) error }

func scanOrder(r scanner) (Order, error) {
	var o Order
	var hasD, hasC int
	var d Delivery
	var c Carriers
	err := r.Scan(&o.ID, &o.OrganisationID, &o.OrganisationName, &o.ServiceDate, &o.Deceased, &o.Notes, &o.Status, &o.ReplyNote,
		&hasD, &d.CarNumber, &d.Time, &d.Destination,
		&hasC, &c.Count, &c.Time, &c.From, &c.CemeteryNumber,
		&o.SubmittedByID, &o.SubmittedByName, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		return o, err
	}
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
	return o, nil
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
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.ServiceDate != b.ServiceDate {
			return a.ServiceDate < b.ServiceDate
		}
		if ta, tb := a.SortTime(), b.SortTime(); ta != tb {
			return ta < tb
		}
		return a.ID < b.ID
	})
	return out, nil
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
	if _, err := tx.ExecContext(ctx, "DELETE FROM transport_order_stops WHERE order_id = ?", id); err != nil {
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
		b2i(in.Delivery != nil), d.CarNumber, d.Time, d.Destination,
		b2i(in.Carriers != nil), c.Count, c.Time, c.From, c.CemeteryNumber}
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
		(service_date, deceased, notes, has_delivery, car_number, delivery_time, destination,
		 has_carriers, carriers_count, carriers_time, carriers_from, cemetery_number,
		 organisation_id, status, created_by_id, created_by_name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args...)
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
		service_date = ?, deceased = ?, notes = ?, has_delivery = ?, car_number = ?, delivery_time = ?, destination = ?,
		has_carriers = ?, carriers_count = ?, carriers_time = ?, carriers_from = ?, cemetery_number = ?, updated_at = ? WHERE id = ?`, args...); err != nil {
		return err
	}
	if err := writeParts(ctx, tx, id, in); err != nil {
		return err
	}
	return addEvent(ctx, tx, id, now, userID, userName, "edited", "", "")
}

// SetOrderStatus records a new status with the reply note shown to the desk.
func SetOrderStatus(ctx context.Context, tx *sql.Tx, id int64, status, note string, userID int64, userName string, now time.Time) error {
	if _, err := tx.ExecContext(ctx, "UPDATE transport_orders SET status = ?, reply_note = ?, updated_at = ? WHERE id = ?", status, note, now.Unix(), id); err != nil {
		return err
	}
	return addEvent(ctx, tx, id, now, userID, userName, "status", status, note)
}
