package registry

import (
	"context"
	"testing"
	"time"
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
