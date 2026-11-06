//go:build bundle

package tunnelbin

import (
	"os"
	"strings"
	"testing"
)

func TestExtractIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	p1, err := Extract(dir)
	if err != nil {
		t.Fatal(err)
	}
	st1, _ := os.Stat(p1)
	p2, err := Extract(dir)
	if err != nil || p1 != p2 {
		t.Fatalf("second extract: %v %q vs %q", err, p2, p1)
	}
	st2, _ := os.Stat(p2)
	if !st1.ModTime().Equal(st2.ModTime()) || st1.Size() != int64(len(embedded)) {
		t.Fatal("file was rewritten or has the wrong size")
	}
}

// scripts/cloudflared.env is the single source of the pinned release for the build scripts.
func TestVersionMatchesBuildScripts(t *testing.T) {
	raw, err := os.ReadFile("../../scripts/cloudflared.env")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "CLOUDFLARED_VERSION=\""+Version+"\"") {
		t.Fatalf("scripts/cloudflared.env does not pin cloudflared %s", Version)
	}
}
