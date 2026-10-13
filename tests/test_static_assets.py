"""Checks that shell templates and the service worker reference real static assets."""
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "app" / "static"


def test_service_worker_precache_assets_exist():
    source = (STATIC / "sw.js").read_text(encoding="utf-8")
    for url in re.findall(r'["\'](/static/[^"\']+)["\']', source):
        asset = STATIC / Path(urlparse(url).path).name
        assert asset.is_file(), f"Service worker references missing asset: {url}"


def test_base_template_static_assets_exist():
    source = (ROOT / "app" / "templates" / "base.html").read_text(encoding="utf-8")
    for url in re.findall(r'(?:href|src)=["\'](/static/[^"\']+)["\']', source):
        asset = STATIC / Path(urlparse(url).path).name
        assert asset.is_file(), f"Base template references missing asset: {url}"
