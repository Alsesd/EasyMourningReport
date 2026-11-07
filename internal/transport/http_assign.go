package transport

import (
	"database/sql"
	"net/http"
	"strings"

	"legkyi/internal/core"
)

type assignPart struct {
	carID    *int64
	time     string
	hasTime  bool
	stops    []string
	hasStops bool
	sameCar  bool
}

func readAssignPart(b *core.Body) *assignPart {
	if b == nil {
		return nil
	}
	ap := &assignPart{sameCar: b.OptBool("same_car", false)}
	ap.carID = b.OptInt("car_id")
	if ap.carID != nil && *ap.carID < 1 {
		b.Fail("car_id", "Некоректне авто", "value_error")
	}
	if b.Has("time") {
		ap.hasTime = true
		if ap.time = timeField(b, "time"); ap.time == "" {
			b.Fail("time", "Вкажіть час", "value_error")
		}
	}
	if b.Has("stops") {
		ap.hasStops = true
		ap.stops = stopNames(b)
	}
	return ap
}

// assignTransportOrder: the dispatcher sets the car, time and stops of an open order (CarLock applies).
func (a *api) assignTransportOrder(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	dp, cp := readAssignPart(body.Object("delivery")), readAssignPart(body.Object("carriers"))
	if err := body.Err(); err != nil {
		return err
	}
	if dp == nil && cp == nil {
		return core.FormError{Message: "Вкажіть, що змінити: delivery чи carriers."}
	}
	ip, name := a.ClientIP(r), p.DisplayName()
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if !Open(o.Status) {
			return core.HTTPError{Status: 409, Detail: "Замовлення вже закрите, призначення змінити не можна."}
		}
		if (dp != nil && o.Delivery == nil) || (cp != nil && o.Carriers == nil) {
			return core.HTTPError{Status: 409, Detail: "У замовленні немає такої частини."}
		}
		keep := o.carIDs()
		var notes []string
		if dp != nil {
			d := *o.Delivery
			if dp.carID != nil {
				cid, text, err := resolveCar(r.Context(), tx, *dp.carID, "", keep)
				if err != nil {
					return err
				}
				d.CarID, d.CarNumber = cid, text
				notes = append(notes, "доставка: авто "+text)
			}
			if dp.hasTime {
				d.Time = dp.time
				notes = append(notes, "доставка: час "+dp.time)
			}
			if dp.hasStops {
				d.Stops = dp.stops
			}
			o.Delivery = &d
		}
		if cp != nil {
			c := *o.Carriers
			if cp.carID != nil {
				cid, text, err := resolveCar(r.Context(), tx, *cp.carID, "", keep)
				if err != nil {
					return err
				}
				c.CarID, c.CarNumber = cid, text
				notes = append(notes, "винос: авто "+text)
			}
			if cp.sameCar && o.Delivery != nil {
				c.CarID, c.CarNumber = o.Delivery.CarID, o.Delivery.CarNumber
				notes = append(notes, "винос: те саме авто")
			}
			if cp.hasTime {
				c.Time = cp.time
				notes = append(notes, "винос: час "+cp.time)
			}
			if cp.hasStops {
				if len(cp.stops) == 0 {
					return core.FormError{Message: "Для виносу потрібна хоча б одна зупинка."}
				}
				c.Stops = cp.stops
			}
			o.Carriers = &c
		}
		in := Input{ServiceDate: o.ServiceDate, Military: o.Military, Delivery: o.Delivery, Carriers: o.Carriers}
		if err := a.claimCars(r.Context(), tx, in, id, p, name, ip); err != nil {
			return err
		}
		if err := SetAssignment(r.Context(), tx, o, p.ID, name, strings.Join(notes, "; "), a.Now()); err != nil {
			return err
		}
		return a.Audit(tx, ip, p, "змінено призначення замовлення транспорту", o.OrganisationName+" · "+o.Deceased+" · "+strings.Join(notes, "; "))
	})
	if err != nil {
		return err
	}
	return a.writeOrder(w, r, p, id)
}

// writeOrder answers with the order as the caller sees it, history included (staff only).
func (a *api) writeOrder(w http.ResponseWriter, r *http.Request, p *core.Caller, id int64) error {
	o, err := a.loadOrder(r, a.Read, p, id)
	if err != nil {
		return err
	}
	var events []Event
	if p.Can(ViewAll, Manage) {
		if events, err = OrderEvents(r.Context(), a.Read, id); err != nil {
			return err
		}
	}
	core.WriteJSON(w, http.StatusOK, a.orderDTO(o, p, events))
	return nil
}

// readLines reads {lines: [{item_id, quantity}]}; the field is required (an empty list clears the cargo).
func readLines(b *core.Body, name string) []Line {
	if !b.Has(name) {
		b.Fail(name, "Field required", "missing")
		return nil
	}
	var out []Line
	for _, l := range b.ObjectList(name, 100) {
		out = append(out, Line{ItemID: l.Int("item_id", 1, false), Quantity: l.Int("quantity", 1, false)})
	}
	return out
}

// linesSummary is "«Труна» ×2, «Хрест» ×1" for a notification or history line.
func linesSummary(lines []CargoLine) string {
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		parts = append(parts, "«"+l.ProductName+"» ×"+itoa(l.Quantity))
	}
	return strings.Join(parts, ", ")
}

// putOrderCargo replaces the cargo an order carries to its organisation.
func (a *api) putOrderCargo(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("oid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	lines := readLines(body, "lines")
	if err := body.Err(); err != nil {
		return err
	}
	ip, name := a.ClientIP(r), p.DisplayName()
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		o, err := a.loadOrder(r, tx, p, id)
		if err != nil {
			return err
		}
		if !Open(o.Status) {
			return core.HTTPError{Status: 409, Detail: "Замовлення вже закрите, вантаж змінити не можна."}
		}
		if _, err := tx.ExecContext(r.Context(), "DELETE FROM transport_cargo WHERE order_id = ?", id); err != nil {
			return err
		}
		if err := placeCargo(r.Context(), tx, o.OrganisationID, id, 0, lines); err != nil {
			return err
		}
		placed, err := loadCargo(r.Context(), tx, "WHERE c.order_id = ?", id)
		if err != nil {
			return err
		}
		summary := linesSummary(placed)
		if err := addEvent(r.Context(), tx, id, a.Now(), p.ID, name, "cargo", "", summary); err != nil {
			return err
		}
		if err := a.Audit(tx, ip, p, "змінено вантаж замовлення транспорту", o.OrganisationName+" · "+o.Deceased+" · "+summary); err != nil {
			return err
		}
		if len(placed) == 0 {
			return nil
		}
		return a.NotifyHolders(r.Context(), tx, p.ID, o.OrganisationID, []string{Create}, "transport.cargo", "Продукцію додано до замовлення транспорту",
			core.JoinNames(o.Deceased, o.ServiceDate, summary), "/admin/transport")
	})
	if err != nil {
		return err
	}
	return a.writeOrder(w, r, p, id)
}
