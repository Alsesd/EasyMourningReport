package transport

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"legkyi/internal/core"
)

// CarLock is how long a car stays taken from the time an order puts it on the road: another order for the same
// car must start at least this long before or after it. (A first, simple rule: no per-car trip length yet.)
const CarLock = 2 * time.Hour

// NormCar makes car numbers comparable: case and spaces do not matter ("АА 1234 ВВ" = "аа1234вв").
func NormCar(s string) string { return strings.Join(strings.Fields(strings.ToLower(s)), "") }

// claim is one part of an order that needs a car at a moment. The date and time are read as wall-clock time:
// only differences between claims matter.
type claim struct {
	car   string
	shown string
	start time.Time
}

func newClaim(date, car, at string) (claim, bool) {
	t, err := time.Parse("2006-01-02 15:04", date+" "+at)
	if NormCar(car) == "" || err != nil {
		return claim{}, false
	}
	return claim{car: NormCar(car), shown: strings.TrimSpace(car), start: t}, true
}

func claimsOf(date string, d *Delivery, c *Carriers) []claim {
	var out []claim
	if d != nil {
		if cl, ok := newClaim(date, d.CarNumber, d.Time); ok {
			out = append(out, cl)
		}
	}
	if c != nil {
		if cl, ok := newClaim(date, c.CarNumber, c.Time); ok {
			out = append(out, cl)
		}
	}
	return out
}

// Conflict is an active order that holds the same car at an overlapping time.
type Conflict struct {
	OrderID, OrganisationID int64
	Status                  string
	Military                bool
	Car                     string    // the car as the new order spells it
	Start                   time.Time // when the other order has the car (wall clock)
}

// activeStatuses hold a car. Done, rejected, cancelled and bumped orders release it.
var activeStatuses = []any{Submitted, Accepted, InProgress}

// FindConflicts lists the active orders (other than excludeID) whose car claim lies less than CarLock away from
// a claim of the new content. Both parts of an order count; the parts of one order never clash with each other.
// Run it in the same transaction as the write that follows: with one writer that makes the check-and-book atomic.
func FindConflicts(ctx context.Context, q core.Querier, in Input, excludeID int64) ([]Conflict, error) {
	mine := claimsOf(in.ServiceDate, in.Delivery, in.Carriers)
	day, err := time.Parse("2006-01-02", in.ServiceDate)
	if err != nil || len(mine) == 0 {
		return nil, nil
	}
	// The lock can cross midnight, so the neighbouring days are read too.
	rows, err := q.QueryContext(ctx, `SELECT id, organisation_id, service_date, status, is_military,
			has_delivery, delivery_car, delivery_time, has_carriers, carriers_car, carriers_time
		FROM transport_orders WHERE service_date IN (?, ?, ?) AND status IN (?, ?, ?) AND id != ?`,
		append([]any{day.AddDate(0, 0, -1).Format("2006-01-02"), in.ServiceDate, day.AddDate(0, 0, 1).Format("2006-01-02")},
			append(append([]any{}, activeStatuses...), excludeID)...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Conflict
	for rows.Next() {
		var c Conflict
		var date, dCar, dTime, cCar, cTime string
		var mil, hasD, hasC int
		if err := rows.Scan(&c.OrderID, &c.OrganisationID, &date, &c.Status, &mil, &hasD, &dCar, &dTime, &hasC, &cCar, &cTime); err != nil {
			return nil, err
		}
		c.Military = mil == 1
		var theirs []claim
		if hasD == 1 {
			if cl, ok := newClaim(date, dCar, dTime); ok {
				theirs = append(theirs, cl)
			}
		}
		if hasC == 1 {
			if cl, ok := newClaim(date, cCar, cTime); ok {
				theirs = append(theirs, cl)
			}
		}
	found:
		for _, m := range mine {
			for _, t := range theirs {
				d := m.start.Sub(t.start)
				if d < 0 {
					d = -d
				}
				if m.car == t.car && d < CarLock {
					c.Car, c.Start = m.shown, t.start
					out = append(out, c)
					break found
				}
			}
		}
	}
	return out, rows.Err()
}

// Bump takes the car away from an order: it becomes bumped (it holds nothing) and keeps its history.
func Bump(ctx context.Context, tx *sql.Tx, id int64, note string, userID int64, userName string, now time.Time) error {
	if _, err := tx.ExecContext(ctx, "UPDATE transport_orders SET status = ?, reply_note = ?, updated_at = ? WHERE id = ?",
		Bumped, note, now.Unix(), id); err != nil {
		return err
	}
	return addEvent(ctx, tx, id, now, userID, userName, "bumped", Bumped, note)
}
