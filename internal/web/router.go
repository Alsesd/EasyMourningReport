package web

import (
	"context"
	"net/http"
	"sort"
	"strings"
)

type paramsKey struct{}

// Param returns a {name} path parameter of the matched route.
func Param(r *http.Request, name string) string {
	m, _ := r.Context().Value(paramsKey{}).(map[string]string)
	return m[name]
}

type apiRoute struct {
	method string
	parts  []string
	h      http.HandlerFunc
}

// Router matches /api/v1 routes and answers unknown paths and wrong methods in the
// FastAPI shape ({"detail": "Not Found" | "Method Not Allowed"}).
type Router struct{ routes []apiRoute }

// Handle registers a route such as ("GET", "/users/{id}") under /api/v1.
func (rt *Router) Handle(method, pattern string, h http.HandlerFunc) {
	rt.routes = append(rt.routes, apiRoute{method, split("/api/v1" + pattern), h})
}

func split(p string) []string { return strings.Split(strings.Trim(p, "/"), "/") }

func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	parts := split(r.URL.Path)
	var allowed []string
	for _, ro := range rt.routes {
		params, ok := match(ro.parts, parts)
		if !ok {
			continue
		}
		if ro.method == r.Method || (ro.method == http.MethodGet && r.Method == http.MethodHead) {
			ro.h(w, r.WithContext(context.WithValue(r.Context(), paramsKey{}, params)))
			return
		}
		allowed = append(allowed, ro.method)
	}
	if len(allowed) > 0 {
		sort.Strings(allowed)
		w.Header().Set("Allow", strings.Join(allowed, ", "))
		httpError(w, r, http.StatusMethodNotAllowed)
		return
	}
	httpError(w, r, http.StatusNotFound)
}

func match(pattern, parts []string) (map[string]string, bool) {
	if len(pattern) != len(parts) {
		return nil, false
	}
	var params map[string]string
	for i, p := range pattern {
		if strings.HasPrefix(p, "{") && strings.HasSuffix(p, "}") {
			if parts[i] == "" {
				return nil, false
			}
			if params == nil {
				params = map[string]string{}
			}
			params[p[1:len(p)-1]] = parts[i]
		} else if p != parts[i] {
			return nil, false
		}
	}
	return params, true
}
