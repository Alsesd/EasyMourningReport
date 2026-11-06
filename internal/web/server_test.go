package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

type okDB struct{ err error }

func (d okDB) Ping() error { return d.err }

func newServer(withIndex bool) *Server {
	m := fstest.MapFS{
		"static/manifest.webmanifest": {Data: []byte(`{"name":"x"}`)},
		"static/sw.js":                {Data: []byte("//sw")},
		"static/offline.html":         {Data: []byte("<p>off</p>")},
		"static/icon-192.png":         {Data: []byte("png")},
		"static/app/assets/main.js":   {Data: []byte("js")},
	}
	if withIndex {
		m["static/app/index.html"] = &fstest.MapFile{Data: []byte("<!doctype html>SPA")}
	}
	return &Server{DB: okDB{}, Assets: m}
}

func do(s *Server, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest(method, path, nil))
	return w
}

// R21: the SPA fallback must never mask /api or /static 404s.
func TestFallbackPrecedence(t *testing.T) {
	s := newServer(true)
	for _, p := range []string{"/", "/reports", "/admin/users/5", "/apix", "/staticx"} {
		if w := do(s, "GET", p); w.Code != 200 || !strings.Contains(w.Body.String(), "SPA") ||
			!strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") {
			t.Errorf("%s: %d %q", p, w.Code, w.Body.String())
		}
	}
	for _, p := range []string{"/api/x", "/api", "/api/", "/static/x", "/static", "/static/", "/static/app/", "/static/app"} {
		w := do(s, "GET", p)
		if w.Code != 404 || strings.Contains(w.Body.String(), "SPA") || !strings.Contains(w.Body.String(), "<h1>Помилка 404</h1>") {
			t.Errorf("%s: %d %q", p, w.Code, w.Body.String())
		}
	}
}

// Only /api/v1/* 404s are JSON; /api/nope stays the HTML page (documented Python behaviour).
func TestAPIv1NotFoundIsJSON(t *testing.T) {
	s := newServer(true)
	for _, p := range []string{"/api/v1", "/api/v1/", "/api/v1/nope"} {
		w := do(s, "GET", p)
		if w.Code != 404 || w.Header().Get("Content-Type") != "application/json" || w.Body.String() != `{"detail":"Not Found"}` {
			t.Errorf("%s: %d %s %q", p, w.Code, w.Header().Get("Content-Type"), w.Body.String())
		}
	}
	if w := do(s, "GET", "/api/nope"); !strings.Contains(w.Body.String(), "<h1>") {
		t.Fatal("expected HTML")
	}
}

func TestNoBuildMeansHTML404(t *testing.T) {
	if w := do(newServer(false), "GET", "/reports"); w.Code != 404 {
		t.Fatal(w.Code)
	}
}

func TestPWAFilesAndHealth(t *testing.T) {
	s := newServer(true)
	w := do(s, "GET", "/sw.js")
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-cache" || w.Header().Get("Content-Type") != "application/javascript" {
		t.Fatalf("sw.js: %d %v", w.Code, w.Header())
	}
	if w := do(s, "GET", "/manifest.webmanifest"); w.Header().Get("Content-Type") != "application/manifest+json" {
		t.Fatal(w.Header())
	}
	if w := do(s, "GET", "/offline"); w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") {
		t.Fatal(w.Header())
	}
	if w := do(s, "GET", "/static/icon-192.png"); w.Code != 200 || w.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	if w := do(s, "GET", "/static/app/assets/main.js"); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := do(s, "GET", "/static/../sw.js"); w.Code != 404 {
		t.Fatal("traversal must 404")
	}
	w = do(s, "GET", "/healthz")
	if w.Code != 200 || w.Body.String() != `{"status":"ok"}` {
		t.Fatalf("%d %q", w.Code, w.Body.String())
	}
	s.DB = okDB{err: http.ErrAbortHandler}
	if w := do(s, "GET", "/healthz"); w.Code != 500 {
		t.Fatal(w.Code)
	}
}

func TestWrongMethodIs405(t *testing.T) {
	s := newServer(true)
	if w := do(s, "POST", "/healthz"); w.Code != 405 {
		t.Fatal(w.Code)
	}
	if w := do(s, "POST", "/some/page"); w.Code != 405 {
		t.Fatal(w.Code)
	}
}

func TestHeadIsAnswered(t *testing.T) {
	s := newServer(true)
	for _, p := range []string{"/healthz", "/sw.js", "/static/icon-192.png", "/reports"} {
		w := do(s, "HEAD", p)
		if w.Code != 200 || w.Body.Len() != 0 && p != "/healthz" {
			t.Errorf("HEAD %s: %d len=%d", p, w.Code, w.Body.Len())
		}
	}
}

func TestJSONNotHTMLEscaped(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, 200, map[string]string{"a": "<b>&"})
	if w.Body.String() != `{"a":"<b>&"}` {
		t.Fatal(w.Body.String())
	}
}
