//go:build bundle

package tunnelbin

import (
	"os"
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
