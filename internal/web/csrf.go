package web

import (
	"net/http"
	"net/url"
	"strings"
)

// sameOriginGuard rejects cross-origin or unverifiable browser mutations (core/security.py).
func sameOriginGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		source := r.Header.Get("Origin")
		if source == "" {
			source = r.Header.Get("Referer")
		}
		var u *url.URL
		if source != "" {
			u, _ = url.Parse(source)
		}
		if u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			plain(w, http.StatusForbidden, "Відхилено запит без перевірки джерела.")
			return
		}
		if strings.ToLower(u.Host) != strings.ToLower(r.Host) {
			plain(w, http.StatusForbidden, "Відхилено запит з іншого джерела.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// plain writes a text body with no Content-Type header (as Starlette's bare Response does).
func plain(w http.ResponseWriter, status int, body string) {
	w.Header()["Content-Type"] = nil // stop net/http from sniffing one
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}
