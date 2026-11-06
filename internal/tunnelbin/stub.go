//go:build !bundle

// Package tunnelbin carries the cloudflared binary inside the executable of a "bundle" build
// (go build -tags bundle, see scripts/build_go.sh). Without the tag it is empty and the tunnel
// uses CLOUDFLARED_PATH or cloudflared from PATH.
package tunnelbin

import "errors"

// Bundled reports whether this build contains cloudflared.
const Bundled = false

// Version is the cloudflared release that is embedded (empty without the bundle tag).
const Version = ""

// Extract is not available without the bundle tag.
func Extract(string) (string, error) {
	return "", errors.New("cloudflared is not bundled in this build")
}
