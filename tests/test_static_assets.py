"""Checks that the service worker references existing static assets."""
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "app" / "static"


def _assert_assets_exist(source: str, pattern: str, context: str) -> None:
    for url in re.findall(pattern, source):
        asset = STATIC / Path(urlparse(url).path).name
        assert asset.is_file(), f"{context} references missing asset: {url}"


def test_service_worker_precache_assets_exist():
    source = (STATIC / "sw.js").read_text(encoding="utf-8")
    _assert_assets_exist(
        source, r"""["'](/static/[^"']+)["']""", "Service worker"
    )
