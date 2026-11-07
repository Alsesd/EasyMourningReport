package registry

import (
	"context"
	"io"
	"path/filepath"
	"testing"
	"time"

	"legkyi/internal/platform"
	"legkyi/internal/store"
)

func TestRegistryDescribesInstalledModules(t *testing.T) {
	r := Installed()
	if len(r.Seeds()) != 2 { // reports and transport bring demo data; the platform does not
		t.Fatalf("seeds: %d", len(r.Seeds()))
	}
	m, p, ok := r.Permission("transport.orders.create")
	if !ok || m.Name != "transport" || p.Scope != "organisation" {
		t.Fatalf("%v %v %v", m.Name, p, ok)
	}
	if _, _, ok := r.Permission("nope"); ok {
		t.Fatal("unknown permission")
	}
	if !r.Codes("platform")["platform.users.manage"] || r.Codes("organisation")["platform.users.manage"] || len(r.Codes("")) < len(r.Codes("platform")) {
		t.Fatal("codes by scope")
	}
	if len(r.Names()) != 4 || len(r.AuditActions()) == 0 || r.DefaultGrants() == nil {
		t.Fatalf("%v", r.Names())
	}
	_ = context.Background
	_ = time.Now
}

// DEMO=1 on an empty database: the modules seed together, the fleet has demo cars (one nonstandard), the demo
// orders are linked to fleet cars, the catalogue has prices, and the start-up backfill adds nothing twice.
func TestDemoSeedGivesTheFleetAndPricedCatalogue(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "reports.db"), "wal")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	r := Installed()
	env := map[string]string{"DEMO": "1", "ADMIN_PASSWORD": "Demo-admin-pass1"}
	tx, err := st.W.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := platform.Seed(tx, func(k string) string { return env[k] }, io.Discard, time.Now(), r.Seeds()...); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		for _, s := range r.Startups() {
			if err := s(context.Background(), tx, time.Now()); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var cars, nonstandard, unlinked, priced int
	st.R.QueryRow("SELECT COUNT(*), COALESCE(SUM(nonstandard), 0) FROM transport_cars").Scan(&cars, &nonstandard)
	st.R.QueryRow("SELECT COUNT(*) FROM transport_orders WHERE delivery_car != '' AND delivery_car_id IS NULL").Scan(&unlinked)
	st.R.QueryRow("SELECT COUNT(*) FROM products WHERE active = 1 AND archived = 0 AND price_cents > 0").Scan(&priced)
	if cars < 4 || nonstandard != 1 || unlinked != 0 || priced == 0 {
		t.Fatalf("cars %d nonstandard %d unlinked orders %d priced products %d", cars, nonstandard, unlinked, priced)
	}
}
