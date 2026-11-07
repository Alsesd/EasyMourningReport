package transport

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"legkyi/internal/store"
)

func TestNormPlateMapsLookalikesAndDropsSeparators(t *testing.T) {
	cases := map[string]string{
		"АА 1234 ВВ":   "АА1234ВВ",
		"aa1234bb":     "АА1234ВВ", // Latin, lower case
		"AA-1234-BB":   "АА1234ВВ",
		" ka.0101.kk ": "КА0101КК",
		"іі 0000 хх":   "ІІ0000ХХ", // Cyrillic lower case
		"ii 0000 xx":   "ІІ0000ХХ", // Latin i is the Ukrainian І
		"ce 1111 ot":   "СЕ1111ОТ",
		"ЗСУ 1234":     "ЗСУ1234",
		"DE 123":  "DЕ123", // E is a lookalike, D is not
	}
	for in, want := range cases {
		if got := NormPlate(in); got != want {
			t.Errorf("NormPlate(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestStandardPlateAndDisplay(t *testing.T) {
	for _, ok := range []string{"aa 1234 bb", "КА0101КК", "ВС-5678-АА"} {
		if n := NormPlate(ok); !StandardPlate(n) {
			t.Errorf("%q should be standard (%q)", ok, n)
		}
	}
	for _, bad := range []string{"АА 1", "ЗСУ1234", "АА12345ВВ", "ББ1234ВВ", "АА1234Б"} {
		if StandardPlate(NormPlate(bad)) {
			t.Errorf("%q must not be standard", bad)
		}
	}
	if d := PlateDisplay("АА1234ВВ"); d != "АА 1234 ВВ" {
		t.Fatalf("display %q", d)
	}
	if d := PlateDisplay("ЗСУ1234"); d != "ЗСУ1234" {
		t.Fatalf("nonstandard display %q", d)
	}
	if !ValidNonstandardPlate("ЗСУ1234") || !ValidNonstandardPlate("DЕ123") || ValidNonstandardPlate("АБ") || ValidNonstandardPlate("А/Б12") {
		t.Fatal("nonstandard validation")
	}
	if CarText("aa1234bb") != "АА 1234 ВВ" || CarText(" Газель білий ") != "Газель білий" {
		t.Fatal("CarText")
	}
}

// The old comparison (lower case, no whitespace) must imply the new one, so old free-text rows keep matching.
func TestNewNormaliserIsASupersetOfTheOldOne(t *testing.T) {
	old := func(s string) string { return strings.Join(strings.Fields(strings.ToLower(s)), "") }
	samples := []string{"АА 1234 ВВ", "аа1234вв", "Аа 1234 вВ", "  аа  1234  вв ", "Газель", "газель ", "ГАЗЕЛЬ",
		"aa 1234 bb", "AA1234BB", "ЗСУ 1234", "зсу1234", "AА 1234 BВ", "ka 0101 kk", "КА 0101 КК", "x", "X", "х"}
	for _, a := range samples {
		for _, b := range samples {
			if old(a) == old(b) && NormPlate(a) != NormPlate(b) {
				t.Errorf("old rule matches %q and %q but the new one does not", a, b)
			}
		}
	}
	// And the new one is wider: a Latin plate matches its Cyrillic twin.
	if NormCar("aa 1234 bb") != NormCar("АА 1234 ВВ") {
		t.Fatal("Latin lookalikes must match")
	}
}

func openStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "reports.db"), "wal")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if err := s.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestBackfillInsertsStandardPlatesOnlyAndIsIdempotent(t *testing.T) {
	s := openStore(t)
	ctx := context.Background()
	if _, err := s.W.Exec("INSERT INTO organisations (name, archived) VALUES ('Філія', 0)"); err != nil {
		t.Fatal(err)
	}
	for _, car := range [][2]string{{"аа 1234 вв", "AA1234BB"}, {"Газель", ""}, {"", "вс 5678 аа"}} {
		if _, err := s.W.Exec(`INSERT INTO transport_orders (organisation_id, service_date, deceased, has_delivery, delivery_car, has_carriers, carriers_car, status, created_at, updated_at)
			VALUES (1, '2026-11-06', 'X', 1, ?, 1, ?, 'done', 1, 1)`, car[0], car[1]); err != nil {
			t.Fatal(err)
		}
	}
	// A car the dispatcher deactivated must stay deactivated.
	if _, err := s.W.Exec("INSERT INTO transport_cars (plate, active, label, created_at) VALUES ('ВС5678АА', 0, 'старе', 1)"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		tx, err := s.W.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err := BackfillCars(ctx, tx, time.Unix(100, 0)); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	cars, err := ListCars(ctx, s.R, true)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, c := range cars {
		got = append(got, c.Plate+":"+map[bool]string{true: "on", false: "off"}[c.Active]+":"+c.Label)
	}
	if strings.Join(got, ",") != "АА1234ВВ:on:,ВС5678АА:off:старе" {
		t.Fatalf("fleet after backfill: %v", got)
	}
	var car string
	s.R.QueryRow("SELECT delivery_car FROM transport_orders WHERE id = 1").Scan(&car)
	if car != "аа 1234 вв" {
		t.Fatalf("an order row must never be rewritten: %q", car)
	}
}

func TestDerivedRequestStatus(t *testing.T) {
	item := func(qty, loaded int64, statuses ...string) RequestItem {
		it := RequestItem{Quantity: qty, Loaded: loaded}
		for _, s := range statuses {
			it.Carriers = append(it.Carriers, ItemCarrier{Status: s})
		}
		return it
	}
	cases := []struct {
		stored string
		items  []RequestItem
		want   string
	}{
		{RequestSubmitted, []RequestItem{item(2, 0)}, RequestSubmitted},
		{RequestSubmitted, []RequestItem{item(2, 1, Accepted)}, RequestPartial},
		{RequestSubmitted, []RequestItem{item(2, 2, Accepted), item(1, 0)}, RequestPartial},
		{RequestSubmitted, []RequestItem{item(2, 2, Accepted, RunPlanned)}, RequestPlanned},
		{RequestSubmitted, []RequestItem{item(2, 2, Done, RunDone), item(1, 1, Done)}, RequestDelivered},
		{RequestSubmitted, []RequestItem{item(2, 1, Done)}, RequestPartial}, // done, but not all loaded
		{RequestCancelled, []RequestItem{item(2, 0)}, RequestCancelled},
		{RequestRejected, []RequestItem{item(2, 0)}, RequestRejected},
	}
	for i, c := range cases {
		r := Request{StoredStatus: c.stored, Items: c.items}
		if got := deriveStatus(&r); got != c.want {
			t.Errorf("case %d: %s, want %s", i, got, c.want)
		}
	}
}
