"""Checks that the PWA service worker references assets that exist in source."""
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]
PUBLIC = ROOT / "src" / "frontend" / "public"


def _assert_assets_exist(source: str, pattern: str, context: str) -> None:
    for url in re.findall(pattern, source):
        asset = PUBLIC / Path(urlparse(url).path).name
        assert asset.is_file(), f"{context} references missing asset: {url}"


def test_service_worker_precache_assets_exist():
    source = (PUBLIC / "sw.js").read_text(encoding="utf-8")
    _assert_assets_exist(
        source, r"""["'](/static/[^"']+)["']""", "Service worker"
    )


def test_manifest_icons_exist():
    source = (PUBLIC / "manifest.webmanifest").read_text(encoding="utf-8")
    _assert_assets_exist(source, r"""["'](/static/[^"']+)["']""", "Manifest")
