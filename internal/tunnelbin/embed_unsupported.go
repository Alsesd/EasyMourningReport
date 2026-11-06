//go:build bundle && !(windows && amd64) && !(linux && amd64) && !(linux && arm64)

package tunnelbin

// A bundled build needs a cloudflared for the target platform (windows/amd64, linux/amd64, linux/arm64).
// Build without -tags bundle for other platforms and provide cloudflared on PATH or via CLOUDFLARED_PATH.
var _ int = "cloudflared is not bundled for this GOOS/GOARCH"
