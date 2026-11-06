// Package web is the HTTP layer: routing, error shapes, static files and the SPA fallback.
package web

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

// Pinger reports whether the database is reachable (store.Store implements it).
type Pinger interface{ Ping() error }

// Server routes requests. Registration order mirrors main.py: PWA files and /healthz, then
// (later slices) the /api/v1 modules, and the SPA fallback strictly last.
type Server struct {
	DB     Pinger
	Assets fs.FS        // contains "static/..."
	API    http.Handler // /api/v1 router (nil: every /api/v1 path is a JSON 404)
}

type route func(w http.ResponseWriter, r *http.Request)

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	get := r.Method == http.MethodGet || r.Method == http.MethodHead
	switch {
	case p == "/healthz":
		s.only(w, r, get, s.healthz)
	case p == "/manifest.webmanifest":
		s.only(w, r, get, func(w http.ResponseWriter, r *http.Request) {
			s.file(w, r, "static/manifest.webmanifest", "application/manifest+json", "")
		})
	case p == "/sw.js":
		s.only(w, r, get, func(w http.ResponseWriter, r *http.Request) {
			s.file(w, r, "static/sw.js", "application/javascript", "no-cache")
		})
	case p == "/offline":
		s.only(w, r, get, func(w http.ResponseWriter, r *http.Request) {
			s.file(w, r, "static/offline.html", "text/html; charset=utf-8", "")
		})
	case strings.HasPrefix(p, "/static/"):
		s.only(w, r, get, s.static)
	case isAPIPath(p):
		if s.API == nil {
			httpError(w, r, http.StatusNotFound)
			return
		}
		s.API.ServeHTTP(w, r)
	default:
		s.only(w, r, get, s.spaFallback)
	}
}

// only answers 405 for other methods (FastAPI answers 405 for a known path with the wrong method).
func (s *Server) only(w http.ResponseWriter, r *http.Request, ok bool, h route) {
	if !ok {
		w.Header().Set("Allow", "GET, HEAD")
		httpError(w, r, http.StatusMethodNotAllowed)
		return
	}
	h(w, r)
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	if err := s.DB.Ping(); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// file serves one embedded file; a missing file is a 404.
func (s *Server) file(w http.ResponseWriter, r *http.Request, name, contentType, cacheControl string) {
	f, err := s.Assets.Open(name)
	if err != nil {
		httpError(w, r, http.StatusNotFound)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		httpError(w, r, http.StatusNotFound)
		return
	}
	rs, ok := f.(readSeeker)
	if !ok {
		httpError(w, r, http.StatusInternalServerError)
		return
	}
	if contentType == "" {
		contentType = mime.TypeByExtension(path.Ext(name))
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	if cacheControl != "" {
		w.Header().Set("Cache-Control", cacheControl)
	}
	http.ServeContent(w, r, name, time.Time{}, rs)
}

type readSeeker interface {
	Read([]byte) (int, error)
	Seek(int64, int) (int64, error)
}

// static serves /static/<path>; directories and missing files are 404.
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/static/")
	if rel == "" || strings.Contains(rel, "..") || strings.HasSuffix(rel, "/") || !fs.ValidPath(rel) {
		httpError(w, r, http.StatusNotFound)
		return
	}
	s.file(w, r, "static/"+rel, "", "")
}

// spaFallback serves index.html for client-side routes but never masks missing API or static files.
func (s *Server) spaFallback(w http.ResponseWriter, r *http.Request) {
	full := strings.TrimPrefix(r.URL.Path, "/")
	if strings.HasPrefix(full, "api/") || full == "api" || strings.HasPrefix(full, "static/") || full == "static" {
		httpError(w, r, http.StatusNotFound)
		return
	}
	s.file(w, r, "static/app/index.html", "text/html; charset=utf-8", "")
}
