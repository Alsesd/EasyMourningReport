package web

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing/fstest"
)

// testAssets mirrors the embedded tree without depending on the gitignored Vite build:
// the real hand-maintained files of internal/assets/static (PWA files, icons) plus a stub SPA index.
func testAssets() fs.FS {
	root := "../assets/static"
	m := fstest.MapFS{"static/app/index.html": {Data: []byte("<!doctype html><title>spa</title>")}}
	entries, err := os.ReadDir(root)
	if err != nil {
		panic(err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(root, e.Name()))
		if err != nil {
			panic(err)
		}
		m["static/"+e.Name()] = &fstest.MapFile{Data: b}
	}
	return m
}
