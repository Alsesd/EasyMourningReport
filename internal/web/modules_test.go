package web

import (
	"strings"
	"testing"
)

// Every route a module lists is registered behind authed/member by the shell: without a session none answers
// anything but 401, whatever the module's handler does.
func TestModuleRoutesRequireSignIn(t *testing.T) {
	e := newEnv(t, nil)
	n := 0
	a := &App{Deps: e.deps}
	for _, m := range a.Registry.Modules {
		if m.Routes == nil {
			continue
		}
		for _, ro := range m.Routes(a.services()) {
			n++
			path := "/api/v1" + ro.Path
			path = strings.NewReplacer("{pid}", "1", "{oid}", "1", "{rid}", "1", "{period}", "2026-10").Replace(path)
			if w := e.do(ro.Method, path, "{}", nil); w.Code != 401 {
				t.Errorf("%s %s without a session: %d, want 401", ro.Method, ro.Path, w.Code)
			}
		}
	}
	if n < 20 {
		t.Fatalf("only %d module routes found", n)
	}
}
