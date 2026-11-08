package web

import (
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"legkyi/internal/registry"
)

func (e *env) status(c *http.Cookie) int {
	return e.do("GET", "/api/v1/session", "", nil, c).Code
}

func (e *env) userID(login string) int64 {
	var id int64
	if err := e.st.R.QueryRow("SELECT id FROM users WHERE login = ?", login).Scan(&id); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func TestLogoutRevokesTheCookieEvenIfReplayed(t *testing.T) {
	e := newEnv(t, nil)
	c := sessionCookie(e.login("boss", "Boss-pass1"))
	if e.status(c) != 200 {
		t.Fatal("fresh session must work")
	}
	e.do("POST", "/api/v1/auth/logout", "", nil, c)
	if got := e.status(c); got != 401 {
		t.Fatalf("a replayed cookie after logout got %d, want 401", got)
	}
}

func TestOwnPasswordChangeEndsOtherDevices(t *testing.T) {
	e := newEnv(t, nil)
	phone := sessionCookie(e.login("boss", "Boss-pass1"))
	laptop := sessionCookie(e.login("boss", "Boss-pass1"))
	changed := e.do("PUT", "/api/v1/me/password", `{"password":"Another-pass1"}`, nil, laptop)
	if changed.Code != 200 {
		t.Fatalf("password change: %d", changed.Code)
	}
	if e.status(phone) != 401 || e.status(laptop) != 401 {
		t.Fatal("old sessions must be revoked")
	}
	if fresh := sessionCookie(changed); fresh == nil || e.status(fresh) != 200 {
		t.Fatal("the device that changed the password stays signed in with a fresh session")
	}
}

func TestAdminPasswordResetAndDisableSignTheUserOut(t *testing.T) {
	e := newEnv(t, nil)
	seedBoss(t, e.st, "second", "Second-pass1")
	boss := sessionCookie(e.login("boss", "Boss-pass1"))
	second := sessionCookie(e.login("second", "Second-pass1"))
	id := e.userID("second")
	if w := e.registerPasskey(t, newAuthenticator(t), second, okFlag|flagAT); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}

	reset := e.do("PUT", fmt.Sprintf("/api/v1/users/%d/password", id), `{"password":"Brand-new-pass1"}`, nil, boss)
	if reset.Code != 200 {
		t.Fatalf("reset: %d %s", reset.Code, reset.Body)
	}
	if e.status(second) != 401 {
		t.Fatal("a reset must sign the user out everywhere")
	}

	var left int
	e.st.R.QueryRow("SELECT COUNT(*) FROM passkeys WHERE user_id = ?", id).Scan(&left)
	if left != 0 {
		t.Fatal("a reset must remove the user's passkeys")
	}

	again := sessionCookie(e.login("second", "Brand-new-pass1"))
	if e.status(again) != 200 {
		t.Fatal("the new password works")
	}
	body, _ := json.Marshal(map[string]any{"login": "second", "full_name": "", "role_ids": e.roleIDs("second"), "active": false})
	if w := e.do("PUT", fmt.Sprintf("/api/v1/users/%d", id), string(body), nil, boss); w.Code != 200 {
		t.Fatalf("disable: %d %s", w.Code, w.Body)
	}
	var n int
	e.st.R.QueryRow("SELECT COUNT(*) FROM user_sessions WHERE user_id = ?", id).Scan(&n)
	if n != 0 || e.status(again) != 401 {
		t.Fatalf("disabling must delete the user's sessions (rows left: %d)", n)
	}
}

func (e *env) roleIDs(login string) []int64 {
	rows, err := e.st.R.Query("SELECT role_id FROM user_roles WHERE user_id = (SELECT id FROM users WHERE login = ?)", login)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids
}

func TestSessionSurvivesRestartAndExpires(t *testing.T) {
	e := newEnv(t, nil)
	c := sessionCookie(e.login("boss", "Boss-pass1"))
	// A new handler on the same database and secret (an app restart) still knows the session.
	restarted := New(Deps{Store: e.st, Assets: testAssets(), Registry: registry.Installed(), Secret: []byte("s"), Now: func() time.Time { return e.now }, Limiter: e.lim})
	req := httptest.NewRequest("GET", "/api/v1/session", nil)
	req.Host, req.RemoteAddr = "testserver", "testclient:50000"
	req.AddCookie(c)
	if d, ok := testDevices.Load(c.Value); ok {
		req.AddCookie(d.(*http.Cookie))
	}
	rec := httptest.NewRecorder()
	restarted.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("after restart: %d", rec.Code)
	}
	e.now = e.now.Add(7*24*time.Hour + time.Second)
	if got := e.status(c); got != 401 {
		t.Fatalf("expired session got %d, want 401", got)
	}
}

func TestOnlyAHashOfTheTokenIsStored(t *testing.T) {
	e := newEnv(t, nil)
	c := sessionCookie(e.login("boss", "Boss-pass1"))
	token := strings.Split(c.Value, ".")[0]
	var stored string
	if err := e.st.R.QueryRow("SELECT token_hash FROM user_sessions").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == token || stored != hashToken(token) || len(stored) != 64 {
		t.Fatalf("the database must hold only the SHA-256 of the token, got %q", stored)
	}
}

// A hash made with fewer iterations than today (an older setting) is upgraded on a successful sign-in only.
func TestWeakerHashIsUpgradedOnSuccessfulLoginOnly(t *testing.T) {
	e := newEnv(t, nil)
	salt := make([]byte, 16)
	key, err := pbkdf2.Key(sha256.New, "Boss-pass1", salt, 1000, 32)
	if err != nil {
		t.Fatal(err)
	}
	legacy := "pbkdf2_sha256$1000$" + hex.EncodeToString(salt) + "$" + hex.EncodeToString(key)
	if _, err := e.st.W.Exec("UPDATE users SET password_hash = ? WHERE login = 'boss'", legacy); err != nil {
		t.Fatal(err)
	}
	stored := func() string {
		var h string
		e.st.R.QueryRow("SELECT password_hash FROM users WHERE login = 'boss'").Scan(&h)
		return h
	}
	if e.login("boss", "wrong-password").Code != 401 || stored() != legacy {
		t.Fatal("a failed login must not touch the stored hash")
	}
	if e.login("boss", "Boss-pass1").Code != 200 {
		t.Fatal("a weaker hash must still sign in")
	}
	if h := stored(); h == legacy || !strings.HasPrefix(h, "pbkdf2_sha256$600000$") {
		t.Fatalf("hash was not upgraded: %q", h)
	}
	if e.login("boss", "Boss-pass1").Code != 200 {
		t.Fatal("the upgraded hash must verify")
	}
}

func TestNewPasswordsFollowThePolicy(t *testing.T) {
	e := newEnv(t, nil)
	c := sessionCookie(e.login("boss", "Boss-pass1"))
	for pw, name := range map[string]string{
		"Abcde1":   "too short",
		"abcdefg1": "no capital",
		"ABCDEFG1": "no small letter",
		"Abcdefgh": "no digit",
	} {
		w := e.do("PUT", "/api/v1/me/password", `{"password":"`+pw+`"}`, nil, c)
		if w.Code != 422 {
			t.Fatalf("%s (%q): %d", name, pw, w.Code)
		}
	}
	// Exactly 8 characters with all three kinds is enough; Cyrillic counts as letters.
	if w := e.do("PUT", "/api/v1/me/password", `{"password":"Abcdef12"}`, nil, c); w.Code != 200 {
		t.Fatalf("8 characters: %d %s", w.Code, w.Body)
	}
	c = sessionCookie(e.login("boss", "Abcdef12"))
	if w := e.do("PUT", "/api/v1/me/password", `{"password":"Пароль123"}`, nil, c); w.Code != 200 {
		t.Fatalf("Cyrillic: %d %s", w.Code, w.Body)
	}
}

func TestExistingWeakPasswordsStillSignIn(t *testing.T) {
	e := newEnv(t, nil)
	seedBoss(t, e.st, "old", "weakpass") // a password from before the policy
	if w := e.login("old", "weakpass"); w.Code != 200 {
		t.Fatalf("sign-in must not enforce the policy on existing passwords: %d", w.Code)
	}
}

func deviceOf(w *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == "device" {
			return c
		}
	}
	return nil
}

func TestSessionCookieWithoutItsDeviceTokenGetsNoAnswerAndIsRevoked(t *testing.T) {
	e := newEnv(t, nil)
	login := e.login("boss", "Boss-pass1")
	session, device := sessionCookie(login), deviceOf(login)
	if device == nil || !device.HttpOnly || device.MaxAge != 604800 {
		t.Fatalf("login must issue the device cookie: %+v", device)
	}
	// A copied session cookie alone: the server hangs up without a word...
	if !e.dropped("GET", "/api/v1/session", &http.Cookie{Name: session.Name, Value: session.Value}) {
		t.Fatal("a session cookie without a device token must be ignored")
	}
	// ...and the session is gone, even for the real browser.
	var n int
	e.st.R.QueryRow("SELECT COUNT(*) FROM user_sessions").Scan(&n)
	if n != 0 {
		t.Fatalf("the replayed session must be revoked, %d left", n)
	}
	if got := e.do("GET", "/api/v1/session", "", nil, session, device).Code; got != 401 {
		t.Fatalf("the real browser is signed out, got %d", got)
	}
}

func TestDeviceTokenOfAnotherSessionIsRejected(t *testing.T) {
	e := newEnv(t, nil)
	a, b := e.login("boss", "Boss-pass1"), e.login("boss", "Boss-pass1")
	if !e.dropped("GET", "/api/v1/session", sessionCookie(a), deviceOf(b)) {
		t.Fatal("a device token issued to another session must be ignored")
	}
}

func TestDeviceTokenRollsAndTheOldOneDiesAfterTheGrace(t *testing.T) {
	e := newEnv(t, nil)
	login := e.login("boss", "Boss-pass1")
	session, first := sessionCookie(login), deviceOf(login)

	if w := e.do("GET", "/api/v1/session", "", nil, session, first); w.Code != 200 || deviceOf(w) != nil {
		t.Fatalf("no rotation before the interval: %d %v", w.Code, deviceOf(w))
	}
	e.now = e.now.Add(deviceRotateEvery + time.Second)
	w := e.do("GET", "/api/v1/session", "", nil, session, first)
	second := deviceOf(w)
	if w.Code != 200 || second == nil || second.Value == first.Value {
		t.Fatalf("the token must roll after the interval: %d %v", w.Code, second)
	}
	// A parallel request that still carries the old token is let through and does not rotate again.
	if w := e.do("GET", "/api/v1/session", "", nil, session, first); w.Code != 200 || deviceOf(w) != nil {
		t.Fatalf("grace: %d %v", w.Code, deviceOf(w))
	}
	if w := e.do("GET", "/api/v1/session", "", nil, session, second); w.Code != 200 {
		t.Fatalf("new token: %d", w.Code)
	}
	// The old token, replayed once the grace has passed, is a copy.
	e.now = e.now.Add(deviceGrace + time.Minute)
	if !e.dropped("GET", "/api/v1/session", session, first) {
		t.Fatal("an old device token after the grace must be ignored")
	}
}

func TestLostRotationResponseIsReissued(t *testing.T) {
	e := newEnv(t, nil)
	login := e.login("boss", "Boss-pass1")
	session, first := sessionCookie(login), deviceOf(login)
	e.now = e.now.Add(deviceRotateEvery + time.Second)
	e.do("GET", "/api/v1/session", "", nil, session, first) // the response with the new cookie never reached the browser
	e.now = e.now.Add(deviceResync + time.Second)
	w := e.do("GET", "/api/v1/session", "", nil, session, first)
	if w.Code != 200 || deviceOf(w) == nil {
		t.Fatalf("the browser must get a fresh token: %d %v", w.Code, deviceOf(w))
	}
}

func TestSessionWithoutDeviceRowFromBeforeThisReleaseIsInvalid(t *testing.T) {
	e := newEnv(t, nil)
	c := sessionCookie(e.login("boss", "Boss-pass1"))
	e.st.W.Exec("DELETE FROM session_devices")
	if got := e.do("GET", "/api/v1/session", "", nil, &http.Cookie{Name: c.Name, Value: c.Value}).Code; got != 401 {
		t.Fatalf("got %d, want 401", got)
	}
}
