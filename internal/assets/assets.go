// Package assets embeds the static files and the compiled SPA.
//
// static/ holds the hand-maintained PWA files (manifest, service worker, icons, offline page).
// static/app/ is the Vite build (`npm run build` in frontend/); it is gitignored and must exist
// before `go build` for the binary to serve the UI.
package assets

import (
	"embed"
	"io/fs"
)

//go:embed all:static
var embedded embed.FS

// FS returns the embedded tree; paths look like "static/manifest.webmanifest".
func FS() fs.FS {
	return embedded
}
