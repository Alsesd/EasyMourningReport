package registry

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The slice rules (CLAUDE.md, docs/architecture.md): a feature module (reports, transport) talks to the rest of the
// program only through core; core, store and platform never import a module. This test reads the real imports so a
// leak fails the build gate instead of being noticed later.

const prefix = "legkyi/internal/"

func importsOf(t *testing.T, pkg string) map[string][]string { // imported internal package -> importing files
	t.Helper()
	dir := filepath.Join("..", pkg)
	files, _ := filepath.Glob(filepath.Join(dir, "*.go"))
	out := map[string][]string{}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") { // tests may wire several packages together
			continue
		}
		af, err := parser.ParseFile(token.NewFileSet(), f, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, im := range af.Imports {
			p := strings.Trim(im.Path.Value, `"`)
			if strings.HasPrefix(p, prefix) {
				name := strings.TrimPrefix(p, prefix)
				out[name] = append(out[name], filepath.Base(f))
			}
		}
	}
	return out
}

func keys(m map[string][]string) []string {
	var k []string
	for n := range m {
		k = append(k, n)
	}
	sort.Strings(k)
	return k
}

func TestPackagesImportOnlyWhatTheirLayerAllows(t *testing.T) {
	allowed := map[string][]string{
		"core":      {},
		"store":     {},
		"reports":   {"core"},
		"transport": {"core"},
		"platform":  {"core", "store"},
		"system":    {"store"},
	}
	for pkg, ok := range allowed {
		imp := importsOf(t, pkg)
		for _, name := range keys(imp) {
			found := false
			for _, a := range ok {
				found = found || a == name
			}
			if !found {
				t.Errorf("internal/%s imports internal/%s (%v): slices talk to core only; allowed: %v", pkg, name, imp[name], ok)
			}
		}
	}
}

// KNOWN DEBT: the HTTP handlers of the two modules still live in internal/web (web/reports.go, web/transport.go) and
// therefore import the module packages. Nothing new may join them: new module logic goes into the module package,
// and the shell reaches it through core.Module hooks (see Module.DailyReminder, Module.Seed). Moving the handlers
// into the modules is tracked in the memory notes.
func TestWebDoesNotGrowNewModuleImports(t *testing.T) {
	known := map[string][]string{
		"reports":   {"reports.go", "reports_xlsx.go"},
		"transport": {"transport.go"},
	}
	imp := importsOf(t, "web")
	for _, mod := range []string{"reports", "transport"} {
		got := imp[mod]
		sort.Strings(got)
		for _, f := range got {
			ok := false
			for _, k := range known[mod] {
				ok = ok || k == f
			}
			if !ok {
				t.Errorf("internal/web/%s imports internal/%s: new slice logic belongs in the module (reach it through core)", f, mod)
			}
		}
	}
	for _, name := range keys(imp) {
		switch name {
		case "core", "platform", "registry", "store", "system", "update", "reports", "transport":
		default:
			t.Errorf("internal/web imports unexpected internal/%s", name)
		}
	}
	if _, err := os.Stat("../web"); err != nil {
		t.Fatal(err)
	}
}
