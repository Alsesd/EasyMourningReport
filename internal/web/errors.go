package web

import (
	"fmt"
	"html"
	"net/http"
	"strings"

	"legkyi/internal/core"
)

// isAPIPath mirrors core/http_errors.py _is_api_request.
func isAPIPath(p string) bool { return p == "/api/v1" || strings.HasPrefix(p, "/api/v1/") }

// writeJSON writes a JSON body with Starlette-compatible compact separators.
func writeJSON(w http.ResponseWriter, status int, v any) { core.WriteJSON(w, status, v) }

var statusText = map[int]string{
	404: "Not Found",
	405: "Method Not Allowed",
}

// httpError answers like the Python handler: {"detail": ...} for /api/v1, an HTML page otherwise.
func httpError(w http.ResponseWriter, r *http.Request, status int) {
	detail := statusText[status]
	if detail == "" {
		detail = http.StatusText(status)
	}
	if isAPIPath(r.URL.Path) {
		writeJSON(w, status, map[string]string{"detail": detail})
		return
	}
	body := fmt.Sprintf(`<!doctype html><html lang="uk"><meta charset="utf-8">`+
		`<meta name="viewport" content="width=device-width, initial-scale=1">`+
		`<title>Помилка %d · Легкий звіт</title>`+
		`<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:1rem">`+
		`<h1>Помилка %d</h1><p>%s</p><p><a href="/">На головну</a></p></body></html>`,
		status, status, html.EscapeString(detail))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}
