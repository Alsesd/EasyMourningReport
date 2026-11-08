package web

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"legkyi/internal/platform"
	"legkyi/internal/registry"
	"legkyi/internal/store"
)

// Replays testdata/contracts/*.json (recorded from the Python app) against web.New.
// Steps that the Go port does not implement yet are listed in testdata/ledger.json; the test
// fails if an unlisted step fails or a listed step passes. Refresh the ledger with LEDGER_RECORD=1.

const contractDir = "../../testdata/contracts/"

var placeholder = regexp.MustCompile(`\{([a-z_][a-z0-9_]*)\}`)

func substitute(v any, saved map[string]any) any {
	switch t := v.(type) {
	case string:
		if m := placeholder.FindStringSubmatch(t); m != nil && m[0] == t {
			if val, ok := saved[m[1]]; ok {
				return val
			}
		}
		return placeholder.ReplaceAllStringFunc(t, func(s string) string {
			if val, ok := saved[s[1:len(s)-1]]; ok {
				return fmt.Sprint(val)
			}
			return s
		})
	case map[string]any:
		out := map[string]any{}
		for k, x := range t {
			out[k] = substitute(x, saved)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = substitute(x, saved)
		}
		return out
	}
	return v
}

// Q5: served times are RFC3339 UTC with an explicit Z.
var dateRE = regexp.MustCompile(`^\d{4}-\d\d-\d\d$`)

var timeFormat = regexp.MustCompile(`^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$`)

// normalise replaces volatile fields after checking their format (so R5/R12 regressions show).
func normalise(v any, problems *[]string) any {
	switch t := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, x := range t {
			if (k == "ts" || k == "created_at" || k == "last_backup_at" || k == "signed_at") && x != nil {
				if s, ok := x.(string); !ok || !timeFormat.MatchString(s) {
					*problems = append(*problems, fmt.Sprintf("%s has bad time format: %v", k, x))
				}
				out[k] = "<time>"
				continue
			}
			out[k] = normalise(x, problems)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = normalise(x, problems)
		}
		return out
	case string:
		if t == time.Now().Format("2006-01") {
			return "<current-period>"
		}
		// Dates of the current month (daily reports: the day, today, the month's first and last day).
		if dateRE.MatchString(t) && strings.HasPrefix(t, time.Now().Format("2006-01")+"-") {
			return "<current-month-date>"
		}
		// Today inside a text (messages and audit details name the day).
		now := time.Now()
		if r := strings.NewReplacer(now.Format("2006-01-02"), "<today>", now.Format("02.01.2006"), "<today>").Replace(t); r != t {
			return r
		}
	}
	return v
}

func dig(data any, path string) (any, bool) {
	for _, part := range strings.Split(path, ".") {
		switch d := data.(type) {
		case []any:
			var i int
			if _, err := fmt.Sscan(part, &i); err != nil || i >= len(d) {
				return nil, false
			}
			data = d[i]
		case map[string]any:
			x, ok := d[part]
			if !ok {
				return nil, false
			}
			data = x
		default:
			return nil, false
		}
	}
	return data, true
}

type client struct{ cookies map[string]string }

func pretty(v any) string { b, _ := json.MarshalIndent(v, "", "  "); return string(b) }

func newContractStore(t *testing.T, schema string) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "reports.db"), "wal")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if schema != "" { // a Python-made database shape (testdata/schema/<name>.sql)
		store.LoadSnapshotForTest(t, s, schema)
	}
	if err := s.EnsureSchema(); err != nil {
		t.Fatal(err)
	}
	return s
}

func seedBoss(t *testing.T, s *store.Store, login, password string) {
	t.Helper()
	tx, err := s.W.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	roles, err := platform.EnsureBuiltInRoles(tx, registry.Installed().DefaultGrants())
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := platform.HashPassword(password, nil)
	if _, err := platform.CreateUser(tx, login, hash, nil, time.Now(), roles[platform.PlatformAdmin]); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

type stepResult struct {
	ok     bool
	detail string
}

func runScenario(t *testing.T, file, schema string) map[string]stepResult {
	raw, err := os.ReadFile(contractDir + file)
	if err != nil {
		t.Fatal(err)
	}
	var sc struct {
		Seed  map[string]map[string]string `json:"seed"`
		Steps []map[string]any             `json:"steps"`
	}
	if err := json.Unmarshal(raw, &sc); err != nil {
		t.Fatal(err)
	}
	st := newContractStore(t, schema)
	boss := sc.Seed["platform_admin"]
	seedBoss(t, st, boss["login"], boss["password"])
	secret := []byte("contract-test-secret")
	h := New(Deps{Store: st, Assets: testAssets(), Registry: registry.Installed(), Secret: secret})

	clients := map[string]*client{}
	saved := map[string]any{}
	results := map[string]stepResult{}
	for i, step := range sc.Steps {
		id := fmt.Sprintf("%s#%d", strings.TrimSuffix(file, ".json"), i+1)
		name, _ := step["name"].(string)
		who, _ := step["as"].(string)
		if who == "" {
			who = "anon"
		}
		c := clients[who]
		if c == nil {
			c = &client{cookies: map[string]string{}}
			clients[who] = c
		}
		var body io.Reader
		contentType := "application/json"
		if j, ok := step["json"]; ok {
			b, _ := json.Marshal(substitute(j, saved))
			body = bytes.NewReader(b)
		}
		if m, ok := step["multipart"].(map[string]any); ok {
			content, err := os.ReadFile(filepath.Join(contractDir, m["path"].(string)))
			if err != nil {
				t.Fatal(err)
			}
			var buf bytes.Buffer
			mw := multipart.NewWriter(&buf)
			fw, _ := mw.CreateFormFile("file", m["filename"].(string))
			fw.Write(content)
			mw.Close()
			body, contentType = &buf, mw.FormDataContentType()
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		req := httptest.NewRequest(step["method"].(string), substitute(step["path"], saved).(string), body).WithContext(ctx)
		req.Host = "testserver"
		req.RemoteAddr = "testclient:50000"
		if body != nil {
			req.Header.Set("Content-Type", contentType)
		}
		if no, _ := step["no_origin"].(bool); !no {
			req.Header.Set("Origin", "http://testserver")
		}
		for k, v := range c.cookies {
			req.AddCookie(&http.Cookie{Name: k, Value: v})
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		cancel()
		resp := w.Result()
		for _, ck := range resp.Cookies() {
			if ck.MaxAge < 0 || ck.Value == "null" {
				delete(c.cookies, ck.Name)
			} else {
				c.cookies[ck.Name] = ck.Value
			}
		}
		actual := map[string]any{"status": float64(resp.StatusCode)}
		var problems []string
		var parsed any
		if strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") {
			if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
				problems = append(problems, "invalid JSON: "+err.Error())
			}
			actual["json"] = normalise(parsed, &problems)
		} else {
			actual["content_type"] = strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
		}
		if parsed != nil {
			if sv, ok := step["save"].(map[string]any); ok {
				for n, field := range sv {
					if val, ok := dig(parsed, field.(string)); ok {
						saved[n] = val
					}
				}
			}
		}
		expect := step["expect"].(map[string]any)
		if reflect.DeepEqual(expect, actual) && len(problems) == 0 {
			results[id] = stepResult{ok: true}
		} else {
			results[id] = stepResult{detail: fmt.Sprintf("step %s «%s» %s %s\n%s\nexpected:\n%s\nactual:\n%s", id, name,
				step["method"], step["path"], strings.Join(problems, "; "), pretty(expect), pretty(actual))}
		}
	}
	return results
}

func TestContractScenarios(t *testing.T) {
	files, _ := filepath.Glob(contractDir + "*.json")
	sort.Strings(files)
	for _, schema := range []string{"", "migrated_very_old", "migrated_previous_release"} {
		label := schema
		if label == "" {
			label = "fresh"
		}
		t.Run(label, func(t *testing.T) {
			all := map[string]stepResult{}
			for _, f := range files {
				for k, v := range runScenario(t, filepath.Base(f), schema) {
					all[k] = v
				}
			}
			checkLedger(t, label, all)
		})
	}
}

type ledger map[string][]string // schema label -> failing step ids

func checkLedger(t *testing.T, label string, results map[string]stepResult) {
	const path = "testdata/ledger.json"
	var failing []string
	for id, r := range results {
		if !r.ok {
			failing = append(failing, id)
		}
	}
	sort.Slice(failing, func(i, j int) bool { return stepOrder(failing[i]) < stepOrder(failing[j]) })
	if os.Getenv("CONTRACT_VERBOSE") != "" && label == "fresh" {
		for _, id := range failing {
			if strings.HasPrefix(id, os.Getenv("CONTRACT_VERBOSE")) {
				t.Log("\n" + results[id].detail)
			}
		}
	}
	if os.Getenv("LEDGER_RECORD") == "1" {
		l := ledger{}
		if b, err := os.ReadFile(path); err == nil {
			json.Unmarshal(b, &l)
		}
		l[label] = failing
		b, _ := json.MarshalIndent(l, "", " ")
		os.MkdirAll("testdata", 0o755)
		os.WriteFile(path, append(b, '\n'), 0o644)
		t.Logf("%s: recorded %d failing / %d total steps", label, len(failing), len(results))
		return
	}
	var l ledger
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("missing %s (run with LEDGER_RECORD=1): %v", path, err)
	}
	json.Unmarshal(b, &l)
	allowed := map[string]bool{}
	for _, id := range l[label] {
		allowed[id] = true
	}
	first := true
	for _, id := range failing {
		if !allowed[id] {
			if first {
				t.Errorf("FIRST UNEXPECTED DIVERGENCE:\n%s", results[id].detail)
				first = false
			} else {
				t.Errorf("unexpected failure: %s", id)
			}
		}
	}
	for id := range allowed {
		if r, ok := results[id]; ok && r.ok {
			t.Errorf("ledger lists %s but it now passes: remove it from testdata/ledger.json", id)
		}
	}
	t.Logf("%s: %d/%d steps pass, %d in ledger", label, len(results)-len(failing), len(results), len(allowed))
}

func stepOrder(id string) int {
	var n int
	i := strings.LastIndex(id, "#")
	fmt.Sscan(id[i+1:], &n)
	return strings.Compare(id[:i], "") + n + 1000*len(id[:i])
}
