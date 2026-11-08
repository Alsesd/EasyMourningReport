package transport

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"legkyi/internal/core"
)

// Request statuses. Only the first three are stored; planned, partial and delivered are derived on every read
// from how much of the request is on carriers (see deriveStatus).
const (
	RequestSubmitted = "submitted"
	RequestPartial   = "partial"
	RequestPlanned   = "planned"
	RequestDelivered = "delivered"
	RequestCancelled = "cancelled"
	RequestRejected  = "rejected"
)

// ItemCarrier is one order or run that carries part of a request item.
type ItemCarrier struct {
	Kind       string // "order" | "run"
	ID         int64
	CarDisplay string
	Time       string
	Status     string
	Quantity   int64
}

// RequestItem is a requested product with how much of it is on carriers.
type RequestItem struct {
	ID, ProductID    int64
	ProductName      string
	Quantity, Loaded int64
	UnitPriceCents   *int64 // the product's latest price when the item was saved; nil = no price
	Carriers         []ItemCarrier
}

// TotalCents is quantity times the unit price (nil without a price).
func (i RequestItem) TotalCents() *int64 {
	if i.UnitPriceCents == nil {
		return nil
	}
	t := i.Quantity * *i.UnitPriceCents
	return &t
}

// Remaining is what is still to be loaded.
func (i RequestItem) Remaining() int64 { return i.Quantity - i.Loaded }

// Request is a desk's product request.
type Request struct {
	ID, OrganisationID        int64
	OrganisationName          string
	NeedDate, Deceased, Notes string
	Status, ReplyNote         string // Status is the derived one
	StoredStatus              string
	Car                       *Car   // the car the desk would like (a preference only), nil = none
	CarPlate                  string // snapshot of its display form
	SubmittedByID             int64
	SubmittedByName           string
	CreatedAt, UpdatedAt      int64
	Items                     []RequestItem
}

// TotalCents sums the priced items.
func (r Request) TotalCents() int64 {
	var t int64
	for _, i := range r.Items {
		if v := i.TotalCents(); v != nil {
			t += *v
		}
	}
	return t
}

// Open reports whether the request still waits to be fully planned (the dispatcher's "unplanned" panel).
func (r Request) Open() bool { return r.Status == RequestSubmitted || r.Status == RequestPartial }

// LoadedAny reports whether any quantity of the request is on an active carrier.
func (r Request) LoadedAny() bool {
	for _, i := range r.Items {
		if i.Loaded > 0 {
			return true
		}
	}
	return false
}

var ErrRequestNotFound = errors.New("product request not found")

// deriveStatus turns the stored status and the loaded quantities into the status clients see.
func deriveStatus(r *Request) string {
	if r.StoredStatus != RequestSubmitted {
		return r.StoredStatus
	}
	var total, loaded int64
	allDone, carriers := true, 0
	for _, i := range r.Items {
		total += i.Quantity
		loaded += i.Loaded
		for _, c := range i.Carriers {
			carriers++
			if c.Status != Done {
				allDone = false
			}
		}
	}
	switch {
	case loaded == 0:
		return RequestSubmitted
	case loaded < total:
		return RequestPartial
	case allDone && carriers > 0:
		return RequestDelivered
	}
	return RequestPlanned
}

const requestColumns = `r.id, r.organisation_id, org.name, r.need_date, r.deceased, r.notes, r.status, r.reply_note,
	c.id, c.plate, c.nonstandard, c.label, c.active, c.created_at, r.car_plate,
	COALESCE(r.created_by_id, 0), r.created_by_name, r.created_at, r.updated_at`

// LoadRequests returns the requests matching where (conditions on r., may be empty) ordered by need date, with
// items, carriers and the derived status.
func LoadRequests(ctx context.Context, q core.Querier, where string, args ...any) ([]Request, error) {
	rows, err := q.QueryContext(ctx, `SELECT `+requestColumns+` FROM product_requests r JOIN organisations org ON org.id = r.organisation_id LEFT JOIN transport_cars c ON c.id = r.car_id `+
		where+` ORDER BY r.need_date, r.id`, args...)
	if err != nil {
		return nil, err
	}
	var out []Request
	for rows.Next() {
		var r Request
		var cid, cns, cact, cat sql.NullInt64
		var cplate, clabel sql.NullString
		if err := rows.Scan(&r.ID, &r.OrganisationID, &r.OrganisationName, &r.NeedDate, &r.Deceased, &r.Notes, &r.StoredStatus, &r.ReplyNote,
			&cid, &cplate, &cns, &clabel, &cact, &cat, &r.CarPlate,
			&r.SubmittedByID, &r.SubmittedByName, &r.CreatedAt, &r.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		if cid.Valid {
			r.Car = &Car{ID: cid.Int64, Plate: cplate.String, Nonstandard: cns.Int64 == 1, Label: clabel.String, Active: cact.Int64 == 1, CreatedAt: cat.Int64}
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if err := fillRequests(ctx, q, out); err != nil {
		return nil, err
	}
	return out, nil
}

// fillRequests loads items, carriers and the derived status of the requests in place.
func fillRequests(ctx context.Context, q core.Querier, reqs []Request) error {
	if len(reqs) == 0 {
		return nil
	}
	ids := make([]int64, len(reqs))
	pos := map[int64]int{}
	for i, r := range reqs {
		ids[i] = r.ID
		pos[r.ID] = i
	}
	in, args := inClause(ids)
	rows, err := q.QueryContext(ctx, `SELECT id, request_id, product_id, product_name, quantity, unit_price_cents FROM product_request_items WHERE request_id IN `+in+` ORDER BY id`, args...)
	if err != nil {
		return err
	}
	itemPos := map[int64][2]int{} // item id -> request index, item index
	var itemIDs []int64
	for rows.Next() {
		var it RequestItem
		var rid int64
		var price sql.NullInt64
		if err := rows.Scan(&it.ID, &rid, &it.ProductID, &it.ProductName, &it.Quantity, &price); err != nil {
			rows.Close()
			return err
		}
		if price.Valid {
			it.UnitPriceCents = &price.Int64
		}
		ri := pos[rid]
		itemPos[it.ID] = [2]int{ri, len(reqs[ri].Items)}
		reqs[ri].Items = append(reqs[ri].Items, it)
		itemIDs = append(itemIDs, it.ID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	add := func(itemID int64, c ItemCarrier) {
		p := itemPos[itemID]
		it := &reqs[p[0]].Items[p[1]]
		it.Loaded += c.Quantity
		it.Carriers = append(it.Carriers, c)
	}
	iin, iargs := inClause(itemIDs)
	// Orders that carry the items (rejected and cancelled ones carry nothing any more).
	orows, err := q.QueryContext(ctx, `SELECT c.item_id, c.quantity, o.id, o.status, o.has_delivery, o.delivery_car, o.delivery_time,
			o.has_carriers, o.carriers_car, o.carriers_time
		FROM transport_cargo c JOIN transport_orders o ON o.id = c.order_id
		WHERE c.item_id IN `+iin+` AND o.status NOT IN ('rejected', 'cancelled') ORDER BY c.id`, iargs...)
	if err != nil {
		return err
	}
	for orows.Next() {
		var itemID, qty int64
		var hasD, hasC int
		var d Delivery
		var c Carriers
		var o Order
		if err := orows.Scan(&itemID, &qty, &o.ID, &o.Status, &hasD, &d.CarNumber, &d.Time, &hasC, &c.CarNumber, &c.Time); err != nil {
			orows.Close()
			return err
		}
		car := ""
		if hasD == 1 {
			o.Delivery = &d
			car = d.CarNumber
		}
		if hasC == 1 {
			o.Carriers = &c
			if car == "" {
				car = c.CarNumber
			}
		}
		add(itemID, ItemCarrier{Kind: "order", ID: o.ID, CarDisplay: CarText(car), Time: o.SortTime(), Status: o.Status, Quantity: qty})
	}
	if err := orows.Err(); err != nil {
		orows.Close()
		return err
	}
	orows.Close()
	rrows, err := q.QueryContext(ctx, `SELECT c.item_id, c.quantity, ru.id, ru.status, ru.car_plate, ru.time
		FROM transport_cargo c JOIN transport_run_stops st ON st.id = c.run_stop_id JOIN transport_runs ru ON ru.id = st.run_id
		WHERE c.item_id IN `+iin+` AND ru.status != 'cancelled' ORDER BY c.id`, iargs...)
	if err != nil {
		return err
	}
	for rrows.Next() {
		var itemID, qty, id int64
		var status, plate, at string
		if err := rrows.Scan(&itemID, &qty, &id, &status, &plate, &at); err != nil {
			rrows.Close()
			return err
		}
		add(itemID, ItemCarrier{Kind: "run", ID: id, CarDisplay: CarText(plate), Time: at, Status: status, Quantity: qty})
	}
	if err := rrows.Err(); err != nil {
		rrows.Close()
		return err
	}
	rrows.Close()
	for i := range reqs {
		reqs[i].Status = deriveStatus(&reqs[i])
	}
	return nil
}

// GetRequest returns one request or ErrRequestNotFound.
func GetRequest(ctx context.Context, q core.Querier, id int64) (Request, error) {
	l, err := LoadRequests(ctx, q, "WHERE r.id = ?", id)
	if err != nil {
		return Request{}, err
	}
	if len(l) == 0 {
		return Request{}, ErrRequestNotFound
	}
	return l[0], nil
}

// NewItem is a requested product with its quantity as the desk sent it.
type NewItem struct {
	ProductID, Quantity int64
	ProductName         string
	UnitPriceCents      *int64
}

// RequestInput is the content of a request a desk submits.
type RequestInput struct {
	NeedDate, Deceased, Notes string
	Car                       *Car // optional preference (resolved by the handler)
	Items                     []NewItem
}

func (in RequestInput) carArgs() (any, string) {
	if in.Car == nil {
		return nil, ""
	}
	return in.Car.ID, in.Car.Display()
}

func writeItems(ctx context.Context, tx *sql.Tx, id int64, items []NewItem) error {
	for _, it := range items {
		if _, err := tx.ExecContext(ctx, "INSERT INTO product_request_items (request_id, product_id, product_name, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)",
			id, it.ProductID, it.ProductName, it.Quantity, it.UnitPriceCents); err != nil {
			return err
		}
	}
	return nil
}

// CreateRequest stores a new request of the organisation.
func CreateRequest(ctx context.Context, tx *sql.Tx, orgID, userID int64, userName string, in RequestInput, now time.Time) (int64, error) {
	carID, carPlate := in.carArgs()
	res, err := tx.ExecContext(ctx, `INSERT INTO product_requests (organisation_id, need_date, deceased, notes, status, car_id, car_plate, created_by_id, created_by_name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, orgID, in.NeedDate, in.Deceased, in.Notes, RequestSubmitted, carID, carPlate, userID, userName, now.Unix(), now.Unix())
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return id, writeItems(ctx, tx, id, in.Items)
}

// UpdateRequest replaces the content of a request (the caller checks that nothing is loaded yet).
func UpdateRequest(ctx context.Context, tx *sql.Tx, id int64, in RequestInput, now time.Time) error {
	carID, carPlate := in.carArgs()
	if _, err := tx.ExecContext(ctx, "UPDATE product_requests SET need_date = ?, deceased = ?, notes = ?, car_id = ?, car_plate = ?, updated_at = ? WHERE id = ?",
		in.NeedDate, in.Deceased, in.Notes, carID, carPlate, now.Unix(), id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM product_request_items WHERE request_id = ?", id); err != nil {
		return err
	}
	return writeItems(ctx, tx, id, in.Items)
}

// SetRequestStatus stores cancelled or rejected (with the dispatcher's note).
func SetRequestStatus(ctx context.Context, tx *sql.Tx, id int64, status, note string, now time.Time) error {
	_, err := tx.ExecContext(ctx, "UPDATE product_requests SET status = ?, reply_note = ?, updated_at = ? WHERE id = ?", status, strings.TrimSpace(note), now.Unix(), id)
	return err
}
