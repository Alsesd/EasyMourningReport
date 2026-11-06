package web

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// authenticator is a software passkey: it signs like a phone's secure enclave would.
type authenticator struct {
	key    *ecdsa.PrivateKey
	credID []byte
	count  uint32
}

func newAuthenticator(t *testing.T) *authenticator {
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	id := make([]byte, 32)
	rand.Read(id)
	return &authenticator{key: k, credID: id}
}

func cborHead(major byte, n int) []byte {
	switch {
	case n < 24:
		return []byte{major<<5 | byte(n)}
	case n < 256:
		return []byte{major<<5 | 24, byte(n)}
	default:
		return []byte{major<<5 | 25, byte(n >> 8), byte(n)}
	}
}
func cborInt(n int) []byte {
	if n >= 0 {
		return cborHead(0, n)
	}
	return cborHead(1, -1-n)
}
func cborBytes(b []byte) []byte { return append(cborHead(2, len(b)), b...) }
func cborText(s string) []byte  { return append(cborHead(3, len(s)), s...) }

func (a *authenticator) cose() []byte {
	pub, _ := a.key.PublicKey.Bytes() // 04 || x || y
	out := cborHead(5, 5)
	out = append(out, cborInt(1)...)
	out = append(out, cborInt(2)...)
	out = append(out, cborInt(3)...)
	out = append(out, cborInt(-7)...)
	out = append(out, cborInt(-1)...)
	out = append(out, cborInt(1)...)
	out = append(out, cborInt(-2)...)
	out = append(out, cborBytes(pub[1:33])...)
	out = append(out, cborInt(-3)...)
	out = append(out, cborBytes(pub[33:65])...)
	return out
}

func authHeader(rp string, flags byte, count uint32) []byte {
	h := sha256.Sum256([]byte(rp))
	b := append([]byte(nil), h[:]...)
	b = append(b, flags)
	return binary.BigEndian.AppendUint32(b, count)
}

func clientJSON(typ string, challenge, origin string) []byte {
	b, _ := json.Marshal(map[string]any{"type": typ, "challenge": challenge, "origin": origin})
	return b
}

func (a *authenticator) register(rp, origin, challenge string, flags byte) map[string]any {
	ad := authHeader(rp, flags, 0)
	ad = append(ad, make([]byte, 16)...)
	ad = binary.BigEndian.AppendUint16(ad, uint16(len(a.credID)))
	ad = append(ad, a.credID...)
	ad = append(ad, a.cose()...)
	obj := cborHead(5, 3)
	obj = append(obj, cborText("fmt")...)
	obj = append(obj, cborText("none")...)
	obj = append(obj, cborText("attStmt")...)
	obj = append(obj, cborHead(5, 0)...)
	obj = append(obj, cborText("authData")...)
	obj = append(obj, cborBytes(ad)...)
	return map[string]any{
		"id": b64.EncodeToString(a.credID), "name": "Тест",
		"client_data_json":   b64.EncodeToString(clientJSON("webauthn.create", challenge, origin)),
		"attestation_object": b64.EncodeToString(obj),
	}
}

func (a *authenticator) assert(rp, origin, challenge string, flags byte, count uint32) map[string]any {
	ad := authHeader(rp, flags, count)
	cd := clientJSON("webauthn.get", challenge, origin)
	h := sha256.Sum256(cd)
	digest := sha256.Sum256(append(append([]byte(nil), ad...), h[:]...))
	sig, _ := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	return map[string]any{
		"id": b64.EncodeToString(a.credID), "client_data_json": b64.EncodeToString(cd),
		"authenticator_data": b64.EncodeToString(ad), "signature": b64.EncodeToString(sig),
	}
}

const (
	rp     = "testserver"
	origin = "https://testserver"
	okFlag = flagUP | flagUV
)

func (e *env) postJSON(path string, v any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	b, _ := json.Marshal(v)
	return e.do("POST", path, string(b), map[string]string{"Origin": origin}, cookies...)
}

func decodeOptions(t *testing.T, w *httptest.ResponseRecorder) (string, string) {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("options: %d %s", w.Code, w.Body)
	}
	var o struct {
		ChallengeID string `json:"challenge_id"`
		PublicKey   struct {
			Challenge string `json:"challenge"`
		} `json:"public_key"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &o); err != nil {
		t.Fatal(err)
	}
	return o.ChallengeID, o.PublicKey.Challenge
}

func (e *env) registerPasskey(t *testing.T, a *authenticator, session *http.Cookie, flags byte) *httptest.ResponseRecorder {
	id, ch := decodeOptions(t, e.postJSON("/api/v1/passkeys/options", map[string]any{}, session))
	body := a.register(rp, origin, ch, flags)
	body["challenge_id"] = id
	return e.postJSON("/api/v1/passkeys", body, session)
}

func (e *env) passkeyLogin(t *testing.T, a *authenticator, flags byte, count uint32) *httptest.ResponseRecorder {
	id, ch := decodeOptions(t, e.postJSON("/api/v1/auth/passkey/options", map[string]any{}))
	body := a.assert(rp, origin, ch, flags, count)
	body["challenge_id"] = id
	return e.postJSON("/api/v1/auth/passkey", body)
}

func TestPasskeyRegisterAndSignInEndToEnd(t *testing.T) {
	e := newEnv(t, nil)
	session := sessionCookie(e.login("boss", "boss-pass"))
	a := newAuthenticator(t)
	if w := e.registerPasskey(t, a, session, okFlag|flagAT); w.Code != 200 {
		t.Fatalf("register: %d %s", w.Code, w.Body)
	}
	list := e.do("GET", "/api/v1/passkeys", "", nil, session)
	if list.Code != 200 || !strings.Contains(list.Body.String(), `"name":"Тест"`) {
		t.Fatalf("list: %d %s", list.Code, list.Body)
	}

	w := e.passkeyLogin(t, a, okFlag, 1)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"login":"boss"`) {
		t.Fatalf("sign-in: %d %s", w.Code, w.Body)
	}
	fresh := sessionCookie(w)
	if fresh == nil || deviceOf(w) == nil || e.status(fresh) != 200 {
		t.Fatal("passkey sign-in must start a normal device-bound session")
	}
	// The same assertion counter again is a cloned authenticator.
	if w := e.passkeyLogin(t, a, okFlag, 1); w.Code != 401 {
		t.Fatalf("replayed counter: %d", w.Code)
	}
	if w := e.passkeyLogin(t, a, okFlag, 2); w.Code != 200 {
		t.Fatalf("next counter: %d %s", w.Code, w.Body)
	}
}

func TestPasskeyRejectsWeakOrForgedCeremonies(t *testing.T) {
	e := newEnv(t, nil)
	session := sessionCookie(e.login("boss", "boss-pass"))
	a := newAuthenticator(t)
	if w := e.registerPasskey(t, a, session, flagUP|flagAT); w.Code != 400 {
		t.Fatalf("a credential without user verification must be refused: %d", w.Code)
	}
	if w := e.registerPasskey(t, a, session, okFlag|flagAT); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	// Unverified user (no biometric/PIN) cannot sign in.
	if w := e.passkeyLogin(t, a, flagUP, 1); w.Code != 401 {
		t.Fatalf("no UV: %d", w.Code)
	}
	// A key the server does not know.
	if w := e.passkeyLogin(t, newAuthenticator(t), okFlag, 1); w.Code != 401 {
		t.Fatalf("unknown key: %d", w.Code)
	}
	// A signature by another key over a known credential id.
	forger := &authenticator{key: newAuthenticator(t).key, credID: a.credID}
	if w := e.passkeyLogin(t, forger, okFlag, 1); w.Code != 401 {
		t.Fatalf("forged signature: %d", w.Code)
	}
	// Wrong origin.
	id, ch := decodeOptions(t, e.postJSON("/api/v1/auth/passkey/options", map[string]any{}))
	body := a.assert(rp, "https://evil.example", ch, okFlag, 5)
	body["challenge_id"] = id
	if w := e.postJSON("/api/v1/auth/passkey", body); w.Code != 401 {
		t.Fatalf("wrong origin: %d", w.Code)
	}
	// A challenge is single-use.
	good := a.assert(rp, origin, ch, okFlag, 6)
	good["challenge_id"] = id
	if w := e.postJSON("/api/v1/auth/passkey", good); w.Code != 401 {
		t.Fatalf("spent challenge: %d", w.Code)
	}
}

func TestPasskeysAreOwnedAndDeletable(t *testing.T) {
	e := newEnv(t, nil)
	seedBoss(t, e.st, "second", "second-pass")
	boss := sessionCookie(e.login("boss", "boss-pass"))
	second := sessionCookie(e.login("second", "second-pass"))
	if w := e.registerPasskey(t, newAuthenticator(t), boss, okFlag|flagAT); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	var id int64
	e.st.R.QueryRow("SELECT id FROM passkeys").Scan(&id)
	if w := e.do("DELETE", "/api/v1/passkeys/"+itoa(int(id)), "", map[string]string{"Origin": origin}, second); w.Code != 404 {
		t.Fatalf("another user's key: %d", w.Code)
	}
	if w := e.do("DELETE", "/api/v1/passkeys/"+itoa(int(id)), "", map[string]string{"Origin": origin}, boss); w.Code != 200 {
		t.Fatalf("delete: %d", w.Code)
	}
}

func TestPasskeysNeedHTTPS(t *testing.T) {
	e := newEnv(t, nil)
	session := sessionCookie(e.login("boss", "boss-pass"))
	w := e.do("POST", "/api/v1/passkeys/options", "{}", map[string]string{"Origin": "http://testserver"}, session)
	if w.Code != 400 {
		t.Fatalf("plain http: %d", w.Code)
	}
}

func TestCBORRejectsJunk(t *testing.T) {
	for _, in := range [][]byte{nil, {0xff}, {0xa1}, {0x5f}, {0x9b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}, {0x43, 1}} {
		if _, _, err := decodeCBOR(in); err == nil {
			t.Fatalf("% x accepted", in)
		}
	}
}

func TestDeletedUsersPasskeyCannotSignInAsSomeoneElse(t *testing.T) {
	e := newEnv(t, nil)
	seedBoss(t, e.st, "second", "second-pass")
	boss := sessionCookie(e.login("boss", "boss-pass"))
	second := sessionCookie(e.login("second", "second-pass"))
	a := newAuthenticator(t)
	if w := e.registerPasskey(t, a, second, okFlag|flagAT); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	id := e.userID("second")
	if w := e.do("DELETE", "/api/v1/users/"+itoa(int(id)), "", map[string]string{"Origin": origin}, boss); w.Code != 200 {
		t.Fatalf("delete user: %d %s", w.Code, w.Body)
	}
	var n int
	e.st.R.QueryRow("SELECT COUNT(*) FROM passkeys").Scan(&n)
	if n != 0 {
		t.Fatalf("the deleted user's passkey must be gone, %d left", n)
	}
	if w := e.passkeyLogin(t, a, okFlag, 1); w.Code != 401 {
		t.Fatalf("sign-in with a deleted user's passkey: %d", w.Code)
	}
}

func TestPasskeyFailuresOfOneAddressDoNotLockOthers(t *testing.T) {
	e := newEnv(t, nil)
	attacker := func(ip string) {
		for i := 0; i < rlPair; i++ {
			id, ch := decodeOptions(t, e.doFrom(ip, "POST", "/api/v1/auth/passkey/options", "{}"))
			body := newAuthenticator(t).assert(rp, origin, ch, okFlag, 1)
			body["challenge_id"] = id
			b, _ := json.Marshal(body)
			e.doFrom(ip, "POST", "/api/v1/auth/passkey", string(b))
		}
	}
	attacker("203.0.113.9:1")
	if w := e.doFrom("203.0.113.9:1", "POST", "/api/v1/auth/passkey/options", "{}"); w.Code != 429 {
		t.Fatalf("the noisy address must be throttled: %d", w.Code)
	}
	if w := e.doFrom("198.51.100.7:1", "POST", "/api/v1/auth/passkey/options", "{}"); w.Code != 200 {
		t.Fatalf("another address must be unaffected: %d", w.Code)
	}
}

func TestChallengesPerAddressAreCapped(t *testing.T) {
	e := newEnv(t, nil)
	for i := 0; i < maxChallengesPerIP; i++ {
		if w := e.doFrom("203.0.113.9:1", "POST", "/api/v1/auth/passkey/options", "{}"); w.Code != 200 {
			t.Fatalf("challenge %d: %d", i, w.Code)
		}
	}
	if w := e.doFrom("203.0.113.9:1", "POST", "/api/v1/auth/passkey/options", "{}"); w.Code != 429 {
		t.Fatalf("over the cap: %d", w.Code)
	}
	if w := e.doFrom("198.51.100.7:1", "POST", "/api/v1/auth/passkey/options", "{}"); w.Code != 200 {
		t.Fatalf("others still get challenges: %d", w.Code)
	}
}

func TestStaleCookieOnAPageLoadIsClearedNotDropped(t *testing.T) {
	e := newEnv(t, nil)
	stale := &http.Cookie{Name: "session", Value: "from-another-app.or-old-secret"}
	if !e.dropped("GET", "/api/v1/session", stale) {
		t.Fatal("API calls with a cookie we never signed get no answer")
	}
	w := e.do("GET", "/", "", nil, stale)
	if w.Code != 200 {
		t.Fatalf("the page must still load: %d", w.Code)
	}
	cleared := false
	for _, c := range w.Result().Cookies() {
		if c.Name == "session" && c.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Fatal("the stale cookie must be expired so sign-in works afterwards")
	}
}
