package transport

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"legkyi/internal/core"
)

type carDTO struct {
	ID          int64  `json:"id"`
	Plate       string `json:"plate"`
	Display     string `json:"display"`
	Nonstandard bool   `json:"nonstandard"`
	Label       string `json:"label"`
	Active      bool   `json:"active"`
}

func carJSON(c Car) carDTO {
	return carDTO{c.ID, c.Plate, c.Display(), c.Nonstandard, c.Label, c.Active}
}

type cargoLineDTO struct {
	ID               int64  `json:"id"`
	ItemID           int64  `json:"item_id"`
	RequestID        int64  `json:"request_id"`
	OrganisationID   int64  `json:"organisation_id"`
	OrganisationName string `json:"organisation_name"`
	ProductName      string `json:"product_name"`
	Quantity         int64  `json:"quantity"`
	UnitPriceCents   *int64 `json:"unit_price_cents"`
	TotalCents       *int64 `json:"total_cents"`
}

type manifestEntryDTO struct {
	OrganisationID   int64          `json:"organisation_id"`
	OrganisationName string         `json:"organisation_name"`
	Place            string         `json:"place"`
	Lines            []cargoLineDTO `json:"lines"`
}

func cargoDTOs(lines []CargoLine) []cargoLineDTO {
	out := make([]cargoLineDTO, 0, len(lines))
	for _, l := range lines {
		out = append(out, cargoLineDTO{l.ID, l.ItemID, l.RequestID, l.OrganisationID, l.OrganisationName, l.ProductName, l.Quantity, l.UnitPriceCents, l.TotalCents()})
	}
	return out
}

func idPtr(id int64) *int64 {
	if id == 0 {
		return nil
	}
	return &id
}

// carFields reads the optional car of an order part: the number as typed and the fleet car id (the id wins).
func carFields(b *core.Body) (string, int64) {
	text := strings.TrimSpace(b.OptString("car_number", "", 30))
	var id int64
	if p := b.OptInt("car_id"); p != nil {
		if *p < 1 {
			b.Fail("car_id", "Некоректне авто", "value_error")
		} else {
			id = *p
		}
	}
	return text, id
}

// resolveCar turns what a desk or dispatcher sent into the stored pair (fleet car id, display text). A fleet car
// wins over typed text; typed text that names an active fleet car is linked to it; any other text stays as typed
// (an old free-text car). keep lists cars the order already holds, which stay allowed even when deactivated since.
func resolveCar(ctx context.Context, q core.Querier, id int64, text string, keep map[int64]bool) (int64, string, error) {
	if id != 0 {
		c, err := GetCar(ctx, q, id)
		if errors.Is(err, ErrCarNotFound) {
			return 0, "", core.FormError{Message: "Авто не знайдено в автопарку."}
		}
		if err != nil {
			return 0, "", err
		}
		if !c.Active && !keep[id] {
			return 0, "", core.FormError{Message: "Авто " + c.Display() + " виведено з автопарку."}
		}
		return c.ID, c.Display(), nil
	}
	if text == "" {
		return 0, "", nil
	}
	if c, err := CarByPlate(ctx, q, NormPlate(text)); err == nil && c.Active {
		return c.ID, c.Display(), nil
	} else if err != nil && !errors.Is(err, ErrCarNotFound) {
		return 0, "", err
	}
	return 0, CarText(text), nil
}

func carFieldError(part, msg, typ string) error {
	return core.ValidationError{Errs: []core.FieldError{{Loc: []any{part, "car_number"}, Msg: msg, Type: typ}}}
}

// deskCar settles the car of one part of a desk's order: a fleet car (car_id) or a legacy number that names a fleet
// car or is a valid standard plate. A desk must choose a car; blank is a 422 on delivery/carriers.car_number.
func deskCar(ctx context.Context, q core.Querier, part string, id int64, text string, keep map[int64]bool) (int64, string, error) {
	if id == 0 && text == "" {
		return 0, "", carFieldError(part, "Field required", "missing")
	}
	cid, shown, err := resolveCar(ctx, q, id, text, keep)
	if err != nil {
		return 0, "", err
	}
	if cid == 0 && !StandardPlate(NormPlate(shown)) {
		return 0, "", carFieldError(part, "Оберіть авто з автопарку або вкажіть номер у вигляді АА 1234 ВВ", "value_error")
	}
	return cid, shown, nil
}

// resolveCars settles the cars of both parts of a desk's order input (see deskCar), then applies "same car".
// The carriers may say same_car instead of naming a car.
func resolveCars(ctx context.Context, q core.Querier, in *Input, keep map[int64]bool) error {
	if in.Delivery != nil {
		id, text, err := deskCar(ctx, q, "delivery", in.Delivery.CarID, in.Delivery.CarNumber, keep)
		if err != nil {
			return err
		}
		in.Delivery.CarID, in.Delivery.CarNumber = id, text
	}
	if in.Carriers != nil {
		if in.SameCar && in.Delivery != nil {
			in.Carriers.CarID, in.Carriers.CarNumber = in.Delivery.CarID, in.Delivery.CarNumber
			return nil
		}
		id, text, err := deskCar(ctx, q, "carriers", in.Carriers.CarID, in.Carriers.CarNumber, keep)
		if err != nil {
			return err
		}
		in.Carriers.CarID, in.Carriers.CarNumber = id, text
	}
	return nil
}

// --- fleet endpoints ---------------------------------------------------------------

func (a *api) listCars(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	all := pm.String("all") == "1" && p.Can(Manage)
	cars, err := ListCars(r.Context(), a.Read, all)
	if err != nil {
		return err
	}
	items := make([]carDTO, 0, len(cars))
	for _, c := range cars {
		items = append(items, carJSON(c))
	}
	core.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func (a *api) createCar(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	raw := body.String("plate", 1, 40)
	nonstandard := body.OptBool("nonstandard", false)
	label := strings.TrimSpace(body.OptString("label", "", 100))
	plate := NormPlate(raw)
	if body.Has("plate") && raw != "" {
		switch {
		case StandardPlate(plate):
			nonstandard = false // it is a standard plate whatever the box says
		case !nonstandard:
			body.Fail("plate", "Номер має вигляд АА 1234 ВВ. Для військового, транзитного чи іноземного номера позначте «Нестандартний номер».", "value_error")
		case !ValidNonstandardPlate(plate):
			body.Fail("plate", "Номер — від 3 до 12 літер і цифр.", "value_error")
		}
	}
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	var car Car
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		if _, err := CarByPlate(r.Context(), tx, plate); err == nil {
			return core.HTTPError{Status: 409, Detail: "Авто з таким номером уже є в автопарку."}
		} else if !errors.Is(err, ErrCarNotFound) {
			return err
		}
		res, err := tx.ExecContext(r.Context(), "INSERT INTO transport_cars (plate, nonstandard, label, active, created_at) VALUES (?, ?, ?, 1, ?)",
			plate, b2i(nonstandard), label, a.Now().Unix())
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		if car, err = GetCar(r.Context(), tx, id); err != nil {
			return err
		}
		return a.Audit(tx, ip, p, "додано авто до автопарку", car.Display())
	})
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, carJSON(car))
	return nil
}

func (a *api) updateCar(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	pm := core.Query(r)
	id := pm.PathInt("cid")
	if err := pm.Err(); err != nil {
		return err
	}
	body, err := core.ReadBody(r)
	if err != nil {
		return err
	}
	var label *string
	if body.Has("label") {
		l := strings.TrimSpace(body.OptString("label", "", 100))
		label = &l
	}
	var active *bool
	if body.Has("active") {
		v := body.Bool("active")
		active = &v
	}
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.ClientIP(r)
	var car Car
	err = a.Write(r.Context(), func(tx *sql.Tx) error {
		var err error
		if car, err = GetCar(r.Context(), tx, id); errors.Is(err, ErrCarNotFound) {
			return core.HTTPError{Status: 404, Detail: "Авто не знайдено."}
		} else if err != nil {
			return err
		}
		if label != nil {
			car.Label = *label
		}
		if active != nil {
			car.Active = *active
		}
		if _, err := tx.ExecContext(r.Context(), "UPDATE transport_cars SET label = ?, active = ? WHERE id = ?", car.Label, b2i(car.Active), id); err != nil {
			return err
		}
		return a.Audit(tx, ip, p, "змінено авто автопарку", car.Display())
	})
	if err != nil {
		return err
	}
	core.WriteJSON(w, http.StatusOK, carJSON(car))
	return nil
}

// --- catalogue ---------------------------------------------------------------------

// activeCatalog reads the products a desk may order through the shell's catalogue service.
func (a *api) activeCatalog(r *http.Request, q core.Querier) ([]core.CatalogProduct, error) {
	if a.Catalog == nil {
		return nil, nil
	}
	return a.Catalog(r.Context(), q)
}

func (a *api) getCatalog(w http.ResponseWriter, r *http.Request, p *core.Caller) error {
	list, err := a.activeCatalog(r, a.Read)
	if err != nil {
		return err
	}
	type item struct {
		ID         int64  `json:"id"`
		Name       string `json:"name"`
		PriceCents *int64 `json:"price_cents"`
	}
	items := make([]item, 0, len(list))
	for _, c := range list {
		items = append(items, item{c.ID, c.Name, c.PriceCents})
	}
	raw, err := json.Marshal(map[string]any{"items": items})
	if err != nil {
		return err
	}
	sum := sha256.Sum256(raw)
	etag := `"` + hex.EncodeToString(sum[:12]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	for _, v := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		if v = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(v), "W/")); v == etag {
			w.WriteHeader(http.StatusNotModified)
			return nil
		}
	}
	core.WriteJSON(w, http.StatusOK, json.RawMessage(raw))
	return nil
}
