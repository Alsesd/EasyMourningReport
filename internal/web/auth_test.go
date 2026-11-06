package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"legkyi/internal/platform"
	"legkyi/internal/registry"
	"legkyi/internal/store"
)

type env struct {
	t   *testing.T
	st  *store.Store
	h   http.Handler
	now time.Time
	lim *LoginLimiter
}

func newEnv(t *testing.T, mut func(*Deps)) *env {
	t.Helper()
	st := newContractStore(t, "")
	seedBoss(t, st, "boss", "boss-pass")
	e := &env{t: t, st: st, now: time.Date(2026, 11, 6, 10, 0, 0, 0, time.UTC)}
	e.lim = NewLoginLimiter()
	e.lim.Now = func() time.Time { return e.now }
	d := Deps{Store: st, Assets: testAssets(), Registry: registry.Installed(), Secret: []byte("s"),
		Now: func() time.Time { return e.now }, Limiter: e.lim}
	if mut != nil {
		mut(&d)
	}
	e.h = New(d)
	return e
}

func (e *env) do(method, path, body string, hdr map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "testserver"
	req.RemoteAddr = "testclient:50000"
	if method != "GET" {
		req.Header.Set("Origin", "http://testserver")
	}
	for k, v := range hdr {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, req)
	return w
}

func (e *env) login(login, pw string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(map[string]string{"login": login, "password": pw})
	return e.do("POST", "/api/v1/auth/login", string(b), nil)
}

func sessionCookie(w *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == "session" {
			return c
		}
	}
	return nil
}

func TestSignerRoundTripTamperForeign(t *testing.T) {
	sg := Signer{Secret: []byte("k")}
	token, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	v := sg.Sign(token)
	if got, ok := sg.Verify(v); !ok || got != token {
		t.Fatal("roundtrip failed")
	}
	if _, ok := sg.Verify(v[:len(v)-1] + "0"); ok && !strings.HasSuffix(v, "0") {
		t.Fatal("tampered signature accepted")
	}
	other := sg.Sign(strings.Repeat("A", 43)) // a well-formed token signed for another value
	parts := strings.Split(v, ".")
	if _, ok := sg.Verify(strings.Split(other, ".")[0] + "." + parts[1]); ok {
		t.Fatal("token swapped under an old signature accepted")
	}
	if _, ok := (Signer{Secret: []byte("other")}).Verify(v); ok {
		t.Fatal("other secret accepted")
	}
	if _, ok := sg.Verify("eyJ1aWQiOjF9.1700000000.abcdef"); ok {
		t.Fatal("old-format cookie accepted")
	}
	if _, ok := sg.Verify(sg.Sign("short")); ok {
		t.Fatal("malformed token accepted")
	}
	for _, junk := range []string{"", "null", "a.b", "...."} {
		if _, ok := sg.Verify(junk); ok {
			t.Fatalf("junk %q accepted", junk)
		}
	}
}

func TestLoginSetsCookieAndSessionWorks(t *testing.T) {
	e := newEnv(t, nil)
	w := e.login("  BOSS ", "boss-pass") // logins are trimmed and case-insensitive
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	c := sessionCookie(w)
	if c == nil || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.MaxAge != 604800 || c.Path != "/" || c.Secure {
		t.Fatalf("cookie: %+v", c)
	}
	r := e.do("GET", "/api/v1/session", "", nil, c)
	if r.Code != 200 || sessionCookie(r) != nil {
		t.Fatalf("session GET: %d cookie=%v (cookie is only written on login/logout, like Starlette)", r.Code, sessionCookie(r))
	}
	if r := e.do("GET", "/api/v1/session", "", nil, &http.Cookie{Name: "session", Value: "garbage"}); r.Code != 401 {
		t.Fatal("garbage cookie must be anonymous")
	}
}

func TestCookieSecureFlagFollowsConfig(t *testing.T) {
	e := newEnv(t, func(d *Deps) { d.CookieSecure = true })
	if c := sessionCookie(e.login("boss", "boss-pass")); c == nil || !c.Secure {
		t.Fatalf("%+v", c)
	}
}

func TestLogoutClearsCookieOnlyWhenThereWasOne(t *testing.T) {
	e := newEnv(t, nil)
	c := sessionCookie(e.login("boss", "boss-pass"))
	w := e.do("POST", "/api/v1/auth/logout", "", nil, c)
	out := sessionCookie(w)
	if w.Code != 200 || out == nil || out.MaxAge >= 0 {
		t.Fatalf("logout: %d %+v", w.Code, out)
	}
	if w := e.do("POST", "/api/v1/auth/logout", "", nil); w.Code != 200 || sessionCookie(w) != nil {
		t.Fatal("anonymous logout must succeed without a cookie")
	}
}

func TestCSRFGuard(t *testing.T) {
	e := newEnv(t, nil)
	body := `{"login":"boss","password":"boss-pass"}`
	w := e.do("POST", "/api/v1/auth/login", body, map[string]string{"Origin": ""})
	if w.Code != 403 || w.Body.String() != "Відхилено запит без перевірки джерела." {
		t.Fatalf("%d %q", w.Code, w.Body.String())
	}
	if ct, present := w.Header()["Content-Type"]; present && len(ct) > 0 {
		t.Fatalf("403 must have no Content-Type, got %v", ct)
	}
	// Referer is accepted when Origin is absent; host comparison is case-insensitive.
	if w := e.do("POST", "/api/v1/auth/login", body, map[string]string{"Origin": "", "Referer": "http://TestServer/x"}); w.Code != 200 {
		t.Fatal("referer fallback", w.Code)
	}
	w = e.do("POST", "/api/v1/auth/login", body, map[string]string{"Origin": "http://evil.example"})
	if w.Code != 403 || w.Body.String() != "Відхилено запит з іншого джерела." {
		t.Fatalf("%d %q", w.Code, w.Body.String())
	}
	if w := e.do("POST", "/api/v1/auth/login", body, map[string]string{"Origin": "ftp://testserver"}); w.Code != 403 {
		t.Fatal("non-http origin")
	}
	if w := e.do("POST", "/api/v1/auth/login", body, map[string]string{"Origin": "http://testserver:8080"}); w.Code != 403 {
		t.Fatal("port mismatch")
	}
}

func TestRateLimit429(t *testing.T) {
	e := newEnv(t, nil)
	for i := 0; i < 5; i++ {
		if w := e.login("boss", "bad"); w.Code != 401 {
			t.Fatal(i, w.Code)
		}
	}
	w := e.login("boss", "boss-pass") // correct password is refused while throttled
	if w.Code != 429 || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Retry-After") != "901" {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	if !strings.Contains(w.Body.String(), "Забагато невдалих спроб") {
		t.Fatal(w.Body.String())
	}
	e.now = e.now.Add(15*time.Minute + time.Second)
	if w := e.login("boss", "boss-pass"); w.Code != 200 {
		t.Fatalf("window expiry: %d", w.Code)
	}
	// Success clears the pair counter.
	for i := 0; i < 4; i++ {
		e.login("boss", "bad")
	}
	e.login("boss", "boss-pass")
	for i := 0; i < 4; i++ {
		if w := e.login("boss", "bad"); w.Code != 401 {
			t.Fatalf("pair counter not cleared: %d", w.Code)
		}
	}
}

func TestRateLimitPerIPAcrossLogins(t *testing.T) {
	e := newEnv(t, nil)
	for i := 0; i < 20; i++ {
		e.login("user"+string(rune('a'+i)), "bad")
	}
	if w := e.login("someone-else", "bad"); w.Code != 429 {
		t.Fatalf("ip limit: %d", w.Code)
	}
}

func TestClientIPTrust(t *testing.T) {
	tr := ParseTrustedHosts("127.0.0.1, 10.0.0.0/8")
	mk := func(peer string, xff ...string) *http.Request {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = peer
		for _, x := range xff {
			r.Header.Add("X-Forwarded-For", x)
		}
		return r
	}
	cases := []struct {
		peer string
		xff  []string
		want string
	}{
		{"127.0.0.1:1", []string{"203.0.113.9"}, "203.0.113.9"},
		{"127.0.0.1:1", []string{"198.51.100.1, 203.0.113.9"}, "203.0.113.9"}, // right-most untrusted
		{"127.0.0.1:1", []string{"203.0.113.9, 10.1.2.3"}, "203.0.113.9"},     // trusted proxy hops skipped
		{"127.0.0.1:1", []string{"6.6.6.6", "203.0.113.9"}, "203.0.113.9"},    // header repeated
		{"127.0.0.1:1", []string{"10.0.0.2, 10.0.0.3"}, "10.0.0.2"},           // all trusted: first
		{"127.0.0.1:1", []string{"[2001:db8::1]:5000"}, "2001:db8::1"},        // bracketed IPv6 with port
		{"127.0.0.1:1", []string{"203.0.113.9:4444"}, "203.0.113.9"},          // port stripped
		{"192.0.2.50:1", []string{"203.0.113.9"}, "192.0.2.50"},               // untrusted peer cannot spoof
		{"127.0.0.1:1", nil, "127.0.0.1"},
		{"testclient:50000", nil, "testclient"},
	}
	for _, c := range cases {
		if got := tr.ClientIP(mk(c.peer, c.xff...)); got != c.want {
			t.Errorf("%s %v: got %s want %s", c.peer, c.xff, got, c.want)
		}
	}
	if got := ParseTrustedHosts("*").ClientIP(mk("8.8.8.8:1", "1.2.3.4, 5.6.7.8")); got != "1.2.3.4" {
		t.Fatalf("*: %s", got)
	}
}

func TestSpoofedXFFDoesNotBypassRateLimit(t *testing.T) {
	e := newEnv(t, nil) // trusted = 127.0.0.1 only; peer is "testclient"
	for i := 0; i < 5; i++ {
		e.do("POST", "/api/v1/auth/login", `{"login":"boss","password":"bad"}`, map[string]string{"X-Forwarded-For": "9.9.9." + string(rune('0'+i))})
	}
	w := e.do("POST", "/api/v1/auth/login", `{"login":"boss","password":"boss-pass"}`, map[string]string{"X-Forwarded-For": "9.9.9.99"})
	if w.Code != 429 {
		t.Fatalf("spoofed XFF bypassed the limit: %d", w.Code)
	}
}

type auditRow struct{ ts, login, role, action, detail, ip string }

func (e *env) audit() []auditRow {
	rows, err := e.st.R.Query("SELECT CAST(ts AS TEXT), login, role, action, detail, ip FROM audit_log ORDER BY id")
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var out []auditRow
	for rows.Next() {
		var r auditRow
		rows.Scan(&r.ts, &r.login, &r.role, &r.action, &r.detail, &r.ip)
		out = append(out, r)
	}
	return out
}

func TestAuditRowsText(t *testing.T) {
	e := newEnv(t, nil)
	e.login("Ghost ", "x")
	e.login("boss", "bad")
	c := sessionCookie(e.login("boss", "boss-pass"))
	changed := e.do("PUT", "/api/v1/me/password", `{"password":"another-pass"}`, nil, c)
	e.do("POST", "/api/v1/auth/logout", "", nil, sessionCookie(changed)) // the old cookie died with the password change
	got := e.audit()
	ts := "2026-11-06 10:00:00.000000"
	want := []auditRow{
		{ts, "ghost", "", "невдалий вхід", "", "testclient"},
		{ts, "boss", "", "невдалий вхід", "", "testclient"},
		{ts, "boss", "Адміністратор", "вхід", "", "testclient"},
		{ts, "boss", "Адміністратор", "змінено власний пароль", "", "testclient"},
		{ts, "boss", "Адміністратор", "вихід", "", "testclient"},
	}
	if len(got) != len(want) {
		t.Fatalf("%v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("row %d: got %+v want %+v", i, got[i], want[i])
		}
	}
	// The unknown-login row records "?" for an empty login.
	e.login("   ", "x")
	if last := e.audit(); last[len(last)-1].login != "?" {
		t.Fatalf("%+v", last[len(last)-1])
	}
}

func TestDisabledAccountsAndArchivedOrganisations(t *testing.T) {
	e := newEnv(t, nil)
	tx, _ := e.st.W.Begin()
	roles, _ := platform.EnsureBuiltInRoles(tx, nil)
	res, _ := tx.Exec("INSERT INTO organisations (name, archived) VALUES ('Shop', 0)")
	oid, _ := res.LastInsertId()
	h, _ := platform.HashPassword("pw", nil)
	platform.CreateUser(tx, "clerk", h, &oid, e.now, roles["store"])
	tx.Commit()

	c := sessionCookie(e.login("clerk", "pw"))
	if c == nil {
		t.Fatal("clerk could not sign in")
	}
	if r := e.do("GET", "/api/v1/session", "", nil, c); r.Code != 200 {
		t.Fatal(r.Code)
	}
	e.st.W.Exec("UPDATE organisations SET archived = 1")
	if r := e.do("GET", "/api/v1/session", "", nil, c); r.Code != 401 {
		t.Fatalf("archived org must sign users out: %d", r.Code)
	}
	w := e.login("clerk", "pw")
	if w.Code != 403 || !strings.Contains(w.Body.String(), "вимкнено") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	e.st.W.Exec("UPDATE organisations SET archived = 0; UPDATE users SET active = 0 WHERE login='clerk'")
	if r := e.do("GET", "/api/v1/session", "", nil, c); r.Code != 401 {
		t.Fatal("disabled user must be signed out")
	}
	e.login("clerk", "pw")
	rows := e.audit()
	if last := rows[len(rows)-1]; last.detail != "обліковий запис вимкнено" || last.role != "Магазин" || last.login != "clerk" {
		t.Fatalf("%+v", last)
	}
	// A rolled-back write must not leave an audit row behind.
	e.st.W.Exec("UPDATE users SET active = 1")
	before := len(e.audit())
	r := e.do("PUT", "/api/v1/me/password", `{"password":"short"}`, nil, sessionCookie(e.login("clerk", "pw")))
	if r.Code != 422 || len(e.audit()) != before+1 { // +1 is the successful login above
		t.Fatalf("%d audit rows %d->%d", r.Code, before, len(e.audit()))
	}
}

func TestEffectivePermissions(t *testing.T) {
	e := newEnv(t, nil)
	r := e.login("boss", "boss-pass")
	var dto sessionDTO
	json.Unmarshal(r.Body.Bytes(), &dto)
	want := "platform.audit.view,platform.organisations.manage,platform.roles.manage,platform.system.manage,platform.users.manage,reports.catalog.manage,reports.review,reports.settings.manage,transport.orders.manage,transport.orders.view_all"
	if strings.Join(dto.Permissions, ",") != want {
		t.Fatalf("%v", dto.Permissions)
	}
}

func TestValidationShapes(t *testing.T) {
	e := newEnv(t, nil)
	for body, want := range map[string]string{
		`{"login":"","password":"x"}`:        `"msg":"String should have at least 1 character"`,
		`{"login":5,"password":"x"}`:         `"type":"string_type"`,
		`{"login":"a","password":"x","z":1}`: ``, // unknown fields ignored: proceeds to a 401
		`[1]`:                                `model_attributes_type`,
		``:                                   `"type":"missing"`,
	} {
		w := e.do("POST", "/api/v1/auth/login", body, nil)
		if want == "" {
			if w.Code != 401 {
				t.Errorf("%q: %d", body, w.Code)
			}
			continue
		}
		if w.Code != 422 || !strings.Contains(w.Body.String(), want) {
			t.Errorf("%q: %d %s", body, w.Code, w.Body.String())
		}
	}
	if w := e.do("GET", "/api/v1/auth/login", "", nil); w.Code != 405 || w.Header().Get("Allow") != "POST" {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
}

func TestLoadSecret(t *testing.T) {
	dir := t.TempDir()
	get := func(string) string { return "" }
	a, err := LoadSecret(get, dir)
	if err != nil || len(a) != 64 {
		t.Fatalf("%q %v", a, err)
	}
	b, _ := LoadSecret(get, dir)
	if string(a) != string(b) {
		t.Fatal("secret must be stable, never overwritten")
	}
	if c, _ := LoadSecret(func(k string) string { return map[string]string{"SECRET_KEY": "env"}[k] }, dir); string(c) != "env" {
		t.Fatal("SECRET_KEY must win")
	}
}
