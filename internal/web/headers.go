package web

import (
	"net"
	"net/http"
	"strings"
)

// contentSecurityPolicy: the SPA is one module script from /static/app plus self-hosted fonts and icons.
// Inline styles stay allowed because React components set style attributes.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; " +
	"object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

// securityHeaders adds the response headers that keep the app out of frames, stop MIME sniffing and
// stop scripts from anywhere but its own files.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

// cookieSecure decides the Secure flag per request: always when COOKIE_SECURE=1, and also when the
// request reached a trusted proxy (the local cloudflared) over https. Plain http on 127.0.0.1 keeps
// working because no https marker is present there.
func cookieSecure(always bool, trusted *TrustedHosts, r *http.Request) bool {
	if always {
		return true
	}
	if trusted == nil {
		return false
	}
	peer := r.RemoteAddr
	if h, _, err := net.SplitHostPort(peer); err == nil {
		peer = h
	}
	if !trusted.Trusts(peer) {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(firstValue(r.Header.Get("X-Forwarded-Proto"))), "https") {
		return true
	}
	return strings.Contains(strings.ToLower(r.Header.Get("Cf-Visitor")), `"scheme":"https"`)
}

func firstValue(v string) string {
	if i := strings.Index(v, ","); i >= 0 {
		return v[:i]
	}
	return v
}
