#!/usr/bin/env bash
# Release build for every platform: dist/legkyi.exe (Windows x64), dist/legkyi (Linux x64) and
# dist/legkyi-linux-arm64 (Linux ARM64 / Android Termux). Each is ONE file with the web UI and a
# SHA-256-checked cloudflared inside. Needs node (22), go and curl; works from Linux.
# Set SKIP_FRONTEND=1 to reuse an existing frontend build. For a build of just this machine use scripts/build.sh.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

bash scripts/fetch_cloudflared.sh windows-amd64 linux-amd64 linux-arm64
if [ -z "${SKIP_FRONTEND:-}" ]; then (cd frontend && npm ci && npm run build); fi
mkdir -p dist
# LEGKYI_VERSION is the release tag. Without it the build is a development build and never updates itself.
stamp=""
if [ -n "${LEGKYI_VERSION:-}" ]; then
  pkg=legkyi/internal/update
  stamp="-X $pkg.Tag=$LEGKYI_VERSION -X $pkg.Commit=$(git rev-parse HEAD) -X $pkg.BuiltAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi
flags=(-trimpath -ldflags="-s -w $stamp" -tags bundle)
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build "${flags[@]}" -o dist/legkyi.exe ./cmd/server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build "${flags[@]}" -o dist/legkyi ./cmd/server
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build "${flags[@]}" -o dist/legkyi-linux-arm64 ./cmd/server
cat > dist/NOTICE.txt <<'EON'
These programs contain cloudflared (https://github.com/cloudflare/cloudflared), licensed under the Apache License 2.0.
EON
ls -l dist/legkyi dist/legkyi.exe dist/legkyi-linux-arm64
