//go:build !bundle

package tunnelbin

import "testing"

func TestPlainBuildsBundleNothing(t *testing.T) {
	if Bundled || Version != "" {
		t.Fatal("a plain build embeds no cloudflared")
	}
	if p, err := Extract(t.TempDir()); err == nil || p != "" {
		t.Fatalf("%q %v", p, err)
	}
}
