#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
uv sync --group dev
uv run --group dev python build.py
uv run --group dev pywrangler deploy
