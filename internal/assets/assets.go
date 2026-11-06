// Package assets embeds the static files and the compiled SPA.
//
// dist/ is filled by scripts/go_assets.sh: dist/static is a copy of backend/app/static
// (PWA files, icons, and the Vite build in static/app). Only dist/.gitkeep is committed.
package assets

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// FS returns the embedded tree rooted at dist (so it contains "static/...").
func FS() fs.FS {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
