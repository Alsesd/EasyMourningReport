package web

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

const (
	team = "acme.cloudflareaccess.com"
	aud  = "aud-tag-123"
)

type accessFixture struct {
	key     *rsa.PrivateKey
	kid     string
	hits    atomic.Int32
	srv     *httptest.Server
	cfg     *AccessConfig
	now     time.Time
	handler http.Handler
}

func newAccess(t *testing.T) *accessFixture {
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &accessFixture{key: k, kid: "k1", now: time.Date(2026, 11, 6, 10, 0, 0, 0, time.UTC)}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.hits.Add(1)
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": f.kid, "kty": "RSA",
			"n": base64.RawURLEncoding.EncodeToString(f.key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(f.key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(f.srv.Close)
	f.cfg = &AccessConfig{TeamDomain: team, Audience: aud, JWKSURL: f.srv.URL, Now: func() time.Time { return f.now }}
	f.handler = accessGuard(f.cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	return f
}

func (f *accessFixture) token(alg, kid string, claims map[string]any, key *rsa.PrivateKey) string {
	enc := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
	signing := enc(map[string]string{"alg": alg, "kid": kid}) + "." + enc(claims)
	if alg == "none" {
		return signing + "."
	}
	d := sha256.Sum256([]byte(signing))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, d[:])
	return signing + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func (f *accessFixture) good() map[string]any {
	return map[string]any{"iss": "https://" + team, "aud": []string{aud}, "exp": f.now.Add(time.Hour).Unix(), "nbf": f.now.Add(-time.Minute).Unix()}
}

// call sends a request as the tunnel would (loopback peer with Cf-Connecting-IP) unless local is set.
func (f *accessFixture) call(token string, local bool) int {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:5555"
	if !local {
		r.Header.Set("Cf-Connecting-IP", "203.0.113.5")
	}
	if token != "" {
		r.Header.Set(accessHeader, token)
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w.Code
}

func TestAccessAcceptsAValidToken(t *testing.T) {
	f := newAccess(t)
	if got := f.call(f.token("RS256", "k1", f.good(), f.key), false); got != 204 {
		t.Fatalf("%d", got)
	}
	c := f.good()
	c["aud"] = aud // a plain string is also valid
	if got := f.call(f.token("RS256", "k1", c, f.key), false); got != 204 {
		t.Fatalf("string aud: %d", got)
	}
}

func TestAccessRefusesBadTokens(t *testing.T) {
	f := newAccess(t)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	mut := func(k string, v any) map[string]any { c := f.good(); c[k] = v; return c }
	cases := map[string]string{
		"missing":       "",
		"wrong aud":     f.token("RS256", "k1", mut("aud", []string{"other"}), f.key),
		"wrong iss":     f.token("RS256", "k1", mut("iss", "https://evil.cloudflareaccess.com"), f.key),
		"expired":       f.token("RS256", "k1", mut("exp", f.now.Add(-time.Hour).Unix()), f.key),
		"not yet valid": f.token("RS256", "k1", mut("nbf", f.now.Add(time.Hour).Unix()), f.key),
		"forged":        f.token("RS256", "k1", f.good(), other),
		"alg none":      f.token("none", "k1", f.good(), nil),
		"alg HS256":     f.token("HS256", "k1", f.good(), f.key),
		"unknown kid":   f.token("RS256", "zzz", f.good(), f.key),
		"garbage":       "a.b.c",
	}
	for name, tok := range cases {
		if got := f.call(tok, false); got != 403 {
			t.Errorf("%s: %d, want 403", name, got)
		}
	}
	// Clock drift within the leeway is tolerated.
	if got := f.call(f.token("RS256", "k1", mut("exp", f.now.Add(-30*time.Second).Unix()), f.key), false); got != 204 {
		t.Errorf("30 s past expiry must pass: %d", got)
	}
}

func TestAccessOnlyGuardsTunnelTraffic(t *testing.T) {
	f := newAccess(t)
	if got := f.call("", true); got != 204 {
		t.Fatalf("local access must stay open: %d", got)
	}
	// A remote peer is never exempt, whatever headers it sends.
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "203.0.113.9:1"
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	if w.Code != 204 { // not loopback: not tunnel traffic, the app's own listener handles exposure
		t.Fatalf("direct remote connection: %d", w.Code)
	}
}

func TestAccessRefetchesKeysOnRotationButRateLimits(t *testing.T) {
	f := newAccess(t)
	if f.call(f.token("RS256", "k1", f.good(), f.key), false) != 204 {
		t.Fatal("first")
	}
	// Cloudflare rotates: a new key id signs the next tokens.
	f.key, _ = rsa.GenerateKey(rand.Reader, 2048)
	f.kid = "k2"
	f.now = f.now.Add(2 * time.Minute)
	if got := f.call(f.token("RS256", "k2", f.good(), f.key), false); got != 204 {
		t.Fatalf("after rotation: %d", got)
	}
	// Unknown kids cannot make us hammer Cloudflare.
	before := f.hits.Load()
	for i := 0; i < 20; i++ {
		f.call(f.token("RS256", "junk", f.good(), f.key), false)
	}
	if f.hits.Load()-before > 1 {
		t.Fatalf("refetches: %d", f.hits.Load()-before)
	}
}

func TestAccessKeepsWorkingWhenCertsGoDownAndRefusesWithoutKeys(t *testing.T) {
	f := newAccess(t)
	tok := f.token("RS256", "k1", f.good(), f.key)
	if f.call(tok, false) != 204 {
		t.Fatal("warm-up")
	}
	f.srv.Close()
	if got := f.call(tok, false); got != 204 {
		t.Fatalf("the last good keys must keep working: %d", got)
	}
	cold := newAccess(t)
	cold.srv.Close()
	if got := cold.call(cold.token("RS256", "k1", cold.good(), cold.key), false); got != 403 {
		t.Fatalf("no keys known: %d", got)
	}
}

func TestAccessOffByDefault(t *testing.T) {
	e := newEnv(t, nil) // no Deps.Access
	r := httptest.NewRequest("GET", "/api/v1/session", nil)
	r.RemoteAddr = "127.0.0.1:1"
	r.Header.Set("Cf-Connecting-IP", "203.0.113.5")
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("%d", w.Code)
	}
}
