package web

import (
	"legkyi/internal/platform"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSecurityHeadersOnEveryResponse(t *testing.T) {
	h := securityHeaders(ParseTrustedHosts("127.0.0.1"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/anything", nil))
	for k, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "same-origin",
	} {
		if got := rec.Header().Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	csp := rec.Header().Get("Content-Security-Policy")
	for _, must := range []string{"script-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"} {
		if !strings.Contains(csp, must) {
			t.Errorf("CSP lacks %q: %s", must, csp)
		}
	}
	if strings.Contains(csp, "script-src 'self' 'unsafe") || strings.Contains(csp, "unsafe-eval") {
		t.Errorf("scripts must not allow inline or eval: %s", csp)
	}
}

func TestCookieSecureFollowsHTTPSFromTrustedProxyOnly(t *testing.T) {
	trusted := ParseTrustedHosts("127.0.0.1")
	req := func(remote string, hdr map[string]string) *http.Request {
		r := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
		r.RemoteAddr = remote
		for k, v := range hdr {
			r.Header.Set(k, v)
		}
		return r
	}
	cases := []struct {
		name   string
		always bool
		r      *http.Request
		want   bool
	}{
		{"plain http on localhost", false, req("127.0.0.1:5000", nil), false},
		{"https via local cloudflared (X-Forwarded-Proto)", false, req("127.0.0.1:5000", map[string]string{"X-Forwarded-Proto": "https"}), true},
		{"https via local cloudflared (Cf-Visitor)", false, req("127.0.0.1:5000", map[string]string{"Cf-Visitor": `{"scheme":"https"}`}), true},
		{"first value of a proxy chain", false, req("127.0.0.1:5000", map[string]string{"X-Forwarded-Proto": "https, http"}), true},
		{"http reported by the proxy", false, req("127.0.0.1:5000", map[string]string{"X-Forwarded-Proto": "http"}), false},
		{"header from an untrusted peer is ignored", false, req("203.0.113.9:5000", map[string]string{"X-Forwarded-Proto": "https"}), false},
		{"COOKIE_SECURE=1 always", true, req("203.0.113.9:5000", nil), true},
	}
	for _, c := range cases {
		if got := cookieSecure(c.always, trusted, c.r); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestUnknownLoginCostsAsMuchAsAWrongPassword(t *testing.T) {
	if testing.Short() {
		t.Skip("timing")
	}
	h, _ := platform.HashPassword("right-password", nil)
	start := time.Now()
	platform.CheckPassword("wrong", h)
	known := time.Since(start)
	start = time.Now()
	platform.CheckPassword("wrong", dummyPasswordHash())
	dummy := time.Since(start)
	if dummy < known/3 {
		t.Fatalf("dummy check (%v) is far cheaper than a real one (%v): usernames would be distinguishable", dummy, known)
	}
}

func TestHSTSOnlyOverHTTPSFromTheTrustedProxy(t *testing.T) {
	h := securityHeaders(ParseTrustedHosts("127.0.0.1"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	get := func(remote, proto string) string {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = remote
		if proto != "" {
			r.Header.Set("X-Forwarded-Proto", proto)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec.Header().Get("Strict-Transport-Security")
	}
	if get("127.0.0.1:1", "https") == "" {
		t.Error("HSTS expected over https via the tunnel")
	}
	if get("127.0.0.1:1", "") != "" || get("203.0.113.5:1", "https") != "" {
		t.Error("no HSTS on plain http or from an untrusted peer")
	}
}
