package assets

import (
	"io/fs"
	"testing"
)

func TestEmbeddedTreeServesTheStaticFiles(t *testing.T) {
	for _, p := range []string{"static/sw.js", "static/manifest.webmanifest", "static/offline.html"} {
		if _, err := fs.Stat(FS(), p); err != nil {
			t.Errorf("%s: %v", p, err)
		}
	}
}
