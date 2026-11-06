#!/usr/bin/env bash
# Build both parts of the app for THIS machine: the web UI (frontend/) and the Go program with the UI and
# cloudflared embedded. Works on Linux, macOS-less Linux ARM, WSL and Termux (Android).
# Result: dist/legkyi  (a single file; run it, nothing else to install).
# Needs: go (1.26+), node + npm (22+), curl.   Set SKIP_FRONTEND=1 to reuse an existing UI build.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

need() { command -v "$1" >/dev/null || { echo "Missing '$1'. $2" >&2; exit 1; }; }
need go "Install Go 1.26+ (Termux: pkg install golang)."
need curl "Install curl."
if [ -z "${SKIP_FRONTEND:-}" ]; then need npm "Install Node.js 22+ (Termux: pkg install nodejs)."; fi

# Target platform = this machine. The SQLite driver does not support GOOS=android, so Termux builds a Linux binary.
case "$(uname -s)" in
  Linux)  goos=linux ;;
  *) echo "scripts/build.sh supports Linux, WSL and Termux. On Windows download legkyi.exe from the release." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64)  goarch=amd64 ;;
  aarch64|arm64) goarch=arm64 ;;
  *) echo "Unsupported CPU '$(uname -m)': only 64-bit x86 and ARM are supported." >&2; exit 1 ;;
esac

# go.mod pins a patched toolchain (go1.26.x). A Go that is new enough but older than the pin would try to download
# one, which does not exist for Android; use the local Go and warn instead.
want="$(sed -n 's/^toolchain go\(.*\)/\1/p' go.mod)"
have="$(go env GOVERSION | sed 's/^go//')"
need_min="$(sed -n 's/^go \(.*\)/\1/p' go.mod)"
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }
if ! ver_ge "$have" "$need_min"; then echo "Go $have is too old: this project needs Go $need_min or newer." >&2; exit 1; fi
if [ -n "$want" ] && ! ver_ge "$have" "$want"; then
  echo "NOTE: Go $have is older than the pinned toolchain go$want; building with the local Go (GOTOOLCHAIN=local)." >&2
  echo "      Update it (Termux: pkg upgrade golang) to get the newest standard-library security fixes." >&2
  export GOTOOLCHAIN=local
fi

echo "== 1/3 cloudflared ($goos/$goarch)"
bash scripts/fetch_cloudflared.sh "$goos-$goarch"

if [ -z "${SKIP_FRONTEND:-}" ]; then
  echo "== 2/3 web UI"
  (cd frontend && npm ci --no-audit --no-fund && npm run build)
else
  echo "== 2/3 web UI: skipped (SKIP_FRONTEND)"
fi
[ -f internal/assets/static/app/index.html ] || { echo "The web UI build is missing (internal/assets/static/app)." >&2; exit 1; }

echo "== 3/3 program"
mkdir -p dist
CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build -trimpath -ldflags="-s -w" -tags bundle -o dist/legkyi ./cmd/server
echo
echo "Built: $root/dist/legkyi ($(du -h dist/legkyi | cut -f1))"
echo "Run:   ADMIN_PASSWORD=choose-a-password ./dist/legkyi     then open http://127.0.0.1:8000"
