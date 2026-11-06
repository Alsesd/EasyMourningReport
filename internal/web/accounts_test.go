package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"legkyi/internal/registry"
)

type session struct {
	e *env
	c *http.Cookie
}

func (s session) do(method, path, body string) *httptest.ResponseRecorder {
	if s.c == nil {
		return s.e.do(method, path, body, nil)
	}
	return s.e.do(method, path, body, nil, s.c)
}

func (e *env) as(login, pw string) session {
	w := e.login(login, pw)
	if w.Code != 200 {
		e.t.Fatalf("login %s: %d %s", login, w.Code, w.Body.String())
	}
	return session{e, sessionCookie(w)}
}

func (s session) json(method, path, body string, want int) map[string]any {
	s.e.t.Helper()
	w := s.do(method, path, body)
	if w.Code != want {
		s.e.t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, want, w.Body.String())
	}
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return out
}

func num(v any) int64 { return int64(v.(float64)) }

func count(e *env, q string, args ...any) int {
	var n int
	if err := e.st.R.QueryRow(q, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

// Deletes must work on every database shape: legacy-migrated tables may lack ON DELETE CASCADE.
func TestDeletesOnAllSchemas(t *testing.T) {
	for _, schema := range []string{"", "migrated_very_old", "migrated_previous_release"} {
		label := schema
		if label == "" {
			label = "fresh"
		}
		t.Run(label, func(t *testing.T) {
			e := newEnvSchema(t, schema)
			boss := e.as("boss", "Boss-pass1")
			org := boss.json("POST", "/api/v1/organisations", `{"name":"Shop","first_user":{"login":"clerk","password":"Clerk-pass1"}}`, 201)
			oid := num(org["id"])
			ids := func(path string) string { return strings.TrimRight(path, "/") }
			_ = ids

			// A user that still holds a role: Python answered 500 here.
			u := boss.json("POST", "/api/v1/users", `{"login":"temp","password":"Temp-pass-1234","organisation_id":`+itoa(int(oid))+`,"role_ids":[3]}`, 201)
			boss.json("DELETE", "/api/v1/users/"+itoa(int(num(u["id"]))), "", 200)
			if n := count(e, "SELECT COUNT(*) FROM user_roles WHERE user_id = ?", num(u["id"])); n != 0 {
				t.Fatalf("%d orphan user_roles", n)
			}

			// A custom role with permissions, assigned to a user, then deleted.
			role := boss.json("POST", "/api/v1/roles", `{"name":"Custom","scope":"organisation","organisation_id":`+itoa(int(oid))+`,"permissions":["reports.submit"]}`, 201)
			rid := itoa(int(num(role["id"])))
			boss.json("POST", "/api/v1/users", `{"login":"holder","password":"Holder-pass-1234","organisation_id":`+itoa(int(oid))+`,"role_ids":[`+rid+`]}`, 201)
			// Settings row of the organisation (a table without cascade on legacy schemas).
			e.st.W.Exec("INSERT OR REPLACE INTO report_settings (organisation_id, calculation_enabled) VALUES (?, 1)", oid)
			boss.json("DELETE", "/api/v1/roles/"+rid, "", 200)
			if n := count(e, "SELECT COUNT(*) FROM role_permissions WHERE role_id = ?", num(role["id"])); n != 0 {
				t.Fatalf("%d orphan role_permissions", n)
			}

			// An organisation with roles, users and settings but no reports is removed completely.
			role2 := boss.json("POST", "/api/v1/roles", `{"name":"Org role","scope":"organisation","organisation_id":`+itoa(int(oid))+`,"permissions":["reports.submit"]}`, 201)
			boss.json("PUT", "/api/v1/users/"+itoa(int(num(boss.json("GET", "/api/v1/session", "", 200)["user_id"]))), `{"login":"boss","role_ids":[1]}`, 200)
			got := boss.json("DELETE", "/api/v1/organisations/"+itoa(int(oid)), "", 200)
			if got["deleted"] != true {
				t.Fatalf("%v", got)
			}
			for _, q := range []string{
				"SELECT COUNT(*) FROM users WHERE organisation_id = " + itoa(int(oid)),
				"SELECT COUNT(*) FROM roles WHERE organisation_id = " + itoa(int(oid)),
				"SELECT COUNT(*) FROM report_settings WHERE organisation_id = " + itoa(int(oid)),
				"SELECT COUNT(*) FROM user_roles WHERE user_id NOT IN (SELECT id FROM users)",
				"SELECT COUNT(*) FROM user_roles WHERE role_id NOT IN (SELECT id FROM roles)",
				"SELECT COUNT(*) FROM role_permissions WHERE role_id NOT IN (SELECT id FROM roles)",
			} {
				if n := count(e, q); n != 0 {
					t.Fatalf("%s -> %d", q, n)
				}
			}
			_ = role2

			// An organisation with a report is archived, not deleted, and stays restorable.
			o2 := boss.json("POST", "/api/v1/organisations", `{"name":"Used"}`, 201)
			e.st.W.Exec("INSERT INTO reports (store_id, period, status) VALUES (?, '2026-10', 'draft')", num(o2["id"]))
			got = boss.json("DELETE", "/api/v1/organisations/"+itoa(int(num(o2["id"]))), "", 200)
			if got["archived"] != true || got["deleted"] != false || !strings.Contains(got["message"].(string), "в архів") {
				t.Fatalf("%v", got)
			}
			list := bossList(t, boss, "/api/v1/organisations")
			var usage map[string]any
			for _, o := range list {
				if o["name"] == "Used" {
					usage = o["usage"].(map[string]any)
				}
			}
			if usage["reports"] != float64(1) {
				t.Fatalf("usage=%v", usage)
			}
			restored := boss.json("POST", "/api/v1/organisations/"+itoa(int(num(o2["id"])))+"/restore", "", 200)
			if restored["archived"] != false {
				t.Fatal(restored)
			}
			// Foreign keys are still enforced.
			var fk int
			e.st.R.QueryRow("PRAGMA foreign_keys").Scan(&fk)
			if fk != 1 {
				t.Fatal("foreign keys off")
			}
		})
	}
}

func bossList(t *testing.T, s session, path string) []map[string]any {
	w := s.do("GET", path, "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var out []map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return out
}

func newEnvSchema(t *testing.T, schema string) *env {
	t.Helper()
	st := newContractStore(t, schema)
	seedBoss(t, st, "boss", "Boss-pass1")
	e := &env{t: t, st: st, now: time.Date(2026, 11, 6, 10, 0, 0, 0, time.UTC), lim: NewLoginLimiter()}
	e.h = New(Deps{Store: st, Assets: testAssets(), Registry: registry.Installed(), Secret: []byte("s"),
		Now: func() time.Time { return e.now }, Limiter: e.lim})
	return e
}

func TestServedTimeAddsZ(t *testing.T) {
	for in, want := range map[string]string{
		"2026-11-06 09:08:07.123456": "2026-11-06T09:08:07.123456Z",
		"2026-11-06 09:08:07.5":      "2026-11-06T09:08:07.500000Z",
		"2026-11-06 09:08:07":        "2026-11-06T09:08:07Z",
		"2026-11-06T09:08:07.123456": "2026-11-06T09:08:07.123456Z",
		"2026-11-06T09:08:07+00:00":  "2026-11-06T09:08:07Z",
		"2026-11-06 09:08:07.000000": "2026-11-06T09:08:07Z",
		"not a time":                 "not a time",
	} {
		if got := ServedTime(in); got != want {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
}

func TestAuditLogEndpointFiltersAndBounds(t *testing.T) {
	e := newEnv(t, nil)
	boss := e.as("boss", "Boss-pass1")
	e.login("nobody", "x")
	var rows []map[string]any
	w := boss.do("GET", "/api/v1/admin/logs?login=NOBO&action="+url.QueryEscape("невдалий вхід"), "")
	json.Unmarshal(w.Body.Bytes(), &rows)
	if w.Code != 200 || len(rows) != 1 || rows[0]["login"] != "nobody" || !strings.HasSuffix(rows[0]["ts"].(string), "Z") {
		t.Fatalf("%d %v", w.Code, rows)
	}
	for _, q := range []string{"limit=0", "limit=501", "limit=abc"} {
		if w := boss.do("GET", "/api/v1/admin/logs?"+q, ""); w.Code != 422 || !strings.Contains(w.Body.String(), `"loc":["query","limit"]`) {
			t.Errorf("%s: %d %s", q, w.Code, w.Body.String())
		}
	}
	if w := boss.do("GET", "/api/v1/users?platform=maybe", ""); w.Code != 422 || !strings.Contains(w.Body.String(), `["query","platform"]`) {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := boss.do("GET", "/api/v1/users?platform=YES", ""); w.Code != 200 {
		t.Fatal("pydantic bool spelling YES")
	}
	if w := boss.do("PUT", "/api/v1/users/abc", `{"login":"xx"}`); w.Code != 422 || !strings.Contains(w.Body.String(), `["path","uid"]`) {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestOrgManagerCannotEscalateOrCrossOrganisations(t *testing.T) {
	e := newEnv(t, nil)
	boss := e.as("boss", "Boss-pass1")
	a := boss.json("POST", "/api/v1/organisations", `{"name":"A","first_user":{"login":"clerka","password":"Clerk-pass1"}}`, 201)
	b := boss.json("POST", "/api/v1/organisations", `{"name":"B","first_user":{"login":"clerkb","password":"Clerk-pass1"}}`, 201)
	aid, bid := itoa(int(num(a["id"]))), itoa(int(num(b["id"])))
	boss.json("POST", "/api/v1/users", `{"login":"mgr","password":"Mgr-pass-1234","organisation_id":`+aid+`,"role_ids":[2]}`, 201)
	mgr := e.as("mgr", "Mgr-pass-1234")

	users := bossList(t, mgr, "/api/v1/users")
	for _, u := range users {
		if u["organisation"].(map[string]any)["name"] != "A" {
			t.Fatalf("org manager sees %v", u)
		}
	}
	// Creating "in organisation B" lands in A (the payload cannot widen the scope).
	got := mgr.json("POST", "/api/v1/users", `{"login":"newbie","password":"Newbie-pass-1234","organisation_id":`+bid+`,"role_ids":[3]}`, 201)
	if got["organisation"].(map[string]any)["name"] != "A" {
		t.Fatalf("%v", got)
	}
	// Another organisation's user is invisible (404), and platform staff too.
	var clerkb map[string]any
	for _, u := range bossList(t, boss, "/api/v1/users?organisation_id="+bid) {
		clerkb = u
	}
	mgr.json("PUT", "/api/v1/users/"+itoa(int(num(clerkb["id"])))+"/password", `{"password":"Hacked-pass-1234"}`, 404)
	mgr.json("DELETE", "/api/v1/users/1", "", 404)
	// Handing out the platform admin role is refused.
	mgr.json("POST", "/api/v1/users", `{"login":"evil","password":"Evil-pass-1234","role_ids":[1]}`, 422)
	if count(e, "SELECT COUNT(*) FROM users WHERE login = 'evil'") != 0 {
		t.Fatal("escalation created a user")
	}
	// Self-disable and self-delete are refused; unauthorised role management is 403.
	me := int(num(mgr.json("GET", "/api/v1/session", "", 200)["user_id"]))
	mgr.json("PUT", "/api/v1/users/"+itoa(me), `{"login":"mgr","active":false,"role_ids":[2]}`, 422)
	mgr.json("DELETE", "/api/v1/users/"+itoa(me), "", 422)
	mgr.json("POST", "/api/v1/roles", `{"name":"x","scope":"organisation"}`, 403)
	// Disabling or deleting the last platform admin is refused (boss edits another admin to be safe).
	boss.json("PUT", "/api/v1/users/1", `{"login":"boss","active":true,"role_ids":[]}`, 422)
}
