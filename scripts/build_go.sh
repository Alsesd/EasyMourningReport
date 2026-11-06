#!/usr/bin/env bash
# Build the single-file executables into dist/ (gitignored): dist/legkyi.exe (Windows) and dist/legkyi (Linux).
# Each contains the web UI, the PWA files and cloudflared (the Cloudflare Tunnel client), so the file
# can be copied anywhere and started. Needs node (22), go and curl on PATH; downloads the pinned
# cloudflared release once into internal/tunnelbin/bin/ and checks its SHA-256.
# Set SKIP_FRONTEND=1 to reuse an existing frontend build.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# Keep in step with Version in internal/tunnelbin/bundle.go.
CLOUDFLARED_VERSION="2026.10.7"
SHA_WINDOWS="2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343"
SHA_LINUX="1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872"

mkdir -p internal/tunnelbin/bin
fetch() { # <release file> <local name> <sha256>
  local dest="internal/tunnelbin/bin/$2"
  if [ -f "$dest" ] && [ "$(sha256sum "$dest" | cut -d' ' -f1)" = "$3" ]; then return; fi
  echo "Downloading cloudflared $CLOUDFLARED_VERSION ($1)"
  curl -fsSL -o "$dest" "https://github.com/cloudflare/cloudflared/releases/download/$CLOUDFLARED_VERSION/$1"
  if [ "$(sha256sum "$dest" | cut -d' ' -f1)" != "$3" ]; then
    rm -f "$dest"; echo "SHA-256 mismatch for $1" >&2; exit 1
  fi
}
fetch cloudflared-windows-amd64.exe cloudflared.exe "$SHA_WINDOWS"
fetch cloudflared-linux-amd64 cloudflared "$SHA_LINUX"

if [ -z "${SKIP_FRONTEND:-}" ]; then (cd frontend && npm ci && npm run build); fi
mkdir -p dist
flags=(-trimpath -ldflags="-s -w" -tags bundle)
# The two targets use different embedded files, so the unused one is hidden by the build tags (GOOS).
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build "${flags[@]}" -o dist/legkyi.exe ./cmd/server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build "${flags[@]}" -o dist/legkyi ./cmd/server
# Android/Termux and other ARM64 Linux: no bundled cloudflared (a generic Linux cloudflared cannot resolve DNS on
# Android); install the tunnel client with `pkg install cloudflared` and start with TUNNEL_ENABLED=1.
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/legkyi-linux-arm64 ./cmd/server
cat > dist/NOTICE.txt <<'EON'
legkyi.exe contains cloudflared (https://github.com/cloudflare/cloudflared), licensed under the Apache License 2.0.
EON
ls -l dist/legkyi dist/legkyi.exe dist/legkyi-linux-arm64
