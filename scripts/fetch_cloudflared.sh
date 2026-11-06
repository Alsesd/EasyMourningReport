#!/usr/bin/env bash
# Download the pinned cloudflared files into internal/tunnelbin/bin/ and verify their SHA-256.
# Usage: fetch_cloudflared.sh <windows-amd64|linux-amd64|linux-arm64>...
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=cloudflared.env
. "$root/scripts/cloudflared.env"
dir="$root/internal/tunnelbin/bin"
mkdir -p "$dir"
sha_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
for target in "$@"; do
  case "$target" in
    windows-amd64) file="cloudflared-windows-amd64.exe"; want="$SHA_WINDOWS_AMD64" ;;
    linux-amd64)   file="cloudflared-linux-amd64";       want="$SHA_LINUX_AMD64" ;;
    linux-arm64)   file="cloudflared-linux-arm64";       want="$SHA_LINUX_ARM64" ;;
    *) echo "unknown target $target" >&2; exit 2 ;;
  esac
  dest="$dir/$file"
  if [ -f "$dest" ] && [ "$(sha_of "$dest")" = "$want" ]; then continue; fi
  echo "Downloading cloudflared $CLOUDFLARED_VERSION ($file)"
  curl -fsSL -o "$dest" "https://github.com/cloudflare/cloudflared/releases/download/$CLOUDFLARED_VERSION/$file"
  if [ "$(sha_of "$dest")" != "$want" ]; then rm -f "$dest"; echo "SHA-256 mismatch for $file" >&2; exit 1; fi
done
