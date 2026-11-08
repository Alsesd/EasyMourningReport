package transport

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"

	"legkyi/internal/core"
)

// latinToCyrillic maps the Latin letters that look like the Cyrillic letters allowed on Ukrainian plates, so a plate
// typed on the wrong keyboard layout is still the same plate.
var latinToCyrillic = map[rune]rune{
	'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н', 'I': 'І',
	'K': 'К', 'M': 'М', 'O': 'О', 'P': 'Р', 'T': 'Т', 'X': 'Х',
}

// NormPlate is the one form in which car numbers are compared and stored in the fleet: trimmed, upper case, without
// spaces, dashes and dots, Latin lookalikes turned into Cyrillic. It is a superset of the old comparison (lower case
// without whitespace): two strings the old rule called equal are equal here too, so free-text orders keep matching.
func NormPlate(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		switch {
		case unicode.IsSpace(r), r == '-', r == '.', r == '‐', r == '‑', r == '‒', r == '–', r == '—', r == ' ':
			continue
		}
		if c, ok := latinToCyrillic[r]; ok {
			r = c
		}
		b.WriteRune(r)
	}
	return b.String()
}

var standardPlateRE = regexp.MustCompile(`^[АВЕІКМНОРСТХ]{2}\d{4}[АВЕІКМНОРСТХ]{2}$`)

// StandardPlate reports whether a normalised plate has the usual Ukrainian shape (АА1234ВВ).
func StandardPlate(norm string) bool { return standardPlateRE.MatchString(norm) }

var otherPlateRE = regexp.MustCompile(`^[A-ZА-ЩЬЮЯІЇЄҐ0-9]{3,12}$`)

// ValidNonstandardPlate: a military, transit or foreign plate is any 3 to 12 letters and digits.
func ValidNonstandardPlate(norm string) bool { return otherPlateRE.MatchString(norm) }

// PlateDisplay is how a plate is shown: «АА 1234 ВВ» for a standard one, the normalised text otherwise.
func PlateDisplay(norm string) string {
	if StandardPlate(norm) {
		r := []rune(norm)
		return string(r[:2]) + " " + string(r[2:6]) + " " + string(r[6:])
	}
	return norm
}

// CarText is the display form of a free-text car string kept on an old order: a plate that normalises to a standard
// one is shown canonically, anything else as it was typed.
func CarText(s string) string {
	if n := NormPlate(s); StandardPlate(n) {
		return PlateDisplay(n)
	}
	return strings.TrimSpace(s)
}

// Car is a vehicle of the fleet.
type Car struct {
	ID          int64
	Plate       string // normalised
	Nonstandard bool
	Label       string
	Active      bool
	CreatedAt   int64
}

// Display is the plate as it is shown.
func (c Car) Display() string { return PlateDisplay(c.Plate) }

var ErrCarNotFound = errors.New("car not found")

const carColumns = `id, plate, nonstandard, label, active, created_at`

func scanCar(r scanner) (Car, error) {
	var c Car
	var ns, act int
	err := r.Scan(&c.ID, &c.Plate, &ns, &c.Label, &act, &c.CreatedAt)
	c.Nonstandard, c.Active = ns == 1, act == 1
	return c, err
}

// ListCars returns the fleet ordered by plate; inactive cars only with all.
func ListCars(ctx context.Context, q core.Querier, all bool) ([]Car, error) {
	where := " WHERE active = 1"
	if all {
		where = ""
	}
	rows, err := q.QueryContext(ctx, `SELECT `+carColumns+` FROM transport_cars`+where+` ORDER BY plate`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Car{}
	for rows.Next() {
		c, err := scanCar(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetCar returns one car or ErrCarNotFound.
func GetCar(ctx context.Context, q core.Querier, id int64) (Car, error) {
	c, err := scanCar(q.QueryRowContext(ctx, `SELECT `+carColumns+` FROM transport_cars WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrCarNotFound
	}
	return c, err
}

// CarByPlate finds a car by its normalised plate (ErrCarNotFound when there is none).
func CarByPlate(ctx context.Context, q core.Querier, norm string) (Car, error) {
	c, err := scanCar(q.QueryRowContext(ctx, `SELECT `+carColumns+` FROM transport_cars WHERE plate = ?`, norm))
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrCarNotFound
	}
	return c, err
}

// BackfillCars adds to the fleet the cars named on existing orders, but only those that read as a standard plate.
// It only inserts (INSERT OR IGNORE on the unique plate): it never changes a car, never touches an order, and a
// second run adds nothing. A car a dispatcher deactivated stays deactivated.
func BackfillCars(ctx context.Context, tx *sql.Tx, now time.Time) error {
	rows, err := tx.QueryContext(ctx, `SELECT delivery_car FROM transport_orders WHERE delivery_car != ''
		UNION SELECT carriers_car FROM transport_orders WHERE carriers_car != ''`)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	var plates []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			rows.Close()
			return err
		}
		if n := NormPlate(s); StandardPlate(n) && !seen[n] {
			seen[n] = true
			plates = append(plates, n)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, p := range plates {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO transport_cars (plate, nonstandard, label, active, created_at) VALUES (?, 0, '', 1, ?)`, p, now.Unix()); err != nil {
			return err
		}
	}
	return nil
}
