//go:build bundle

package tunnelbin

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Bundled reports whether this build contains cloudflared.
const Bundled = true

// Version is the pinned cloudflared release (scripts/build_go.sh downloads exactly this one).
const Version = "2026.10.7"

// Extract writes the embedded cloudflared into dir as cloudflared-<version>[.exe] and returns its
// path. An existing file with identical content is reused. The version in the name keeps an old
// copy that is still running (Windows locks it) from blocking an upgrade.
func Extract(dir string) (string, error) {
	name := "cloudflared-" + Version
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	target := filepath.Join(dir, name)
	if same(target, embedded) {
		return target, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(dir, "cloudflared-*.tmp")
	if err != nil {
		return "", err
	}
	_, werr := tmp.Write(embedded)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		os.Remove(tmp.Name())
		return "", fmt.Errorf("writing cloudflared: %v %v", werr, cerr)
	}
	if err := os.Chmod(tmp.Name(), 0o755); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	if err := os.Rename(tmp.Name(), target); err != nil {
		os.Remove(tmp.Name())
		if same(target, embedded) { // another process won the race
			return target, nil
		}
		return "", err
	}
	return target, nil
}

func same(path string, want []byte) bool {
	st, err := os.Stat(path)
	if err != nil || st.Size() != int64(len(want)) {
		return false
	}
	got, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	a, b := sha256.Sum256(got), sha256.Sum256(want)
	return bytes.Equal(a[:], b[:])
}
