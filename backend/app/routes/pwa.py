"""Progressive Web App (PWA) static manifests and offline fallbacks."""

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from app.core.paths import asset_dir
from app.core.web import render


router = APIRouter()
STATIC_DIR = asset_dir("static")


@router.get("/manifest.webmanifest")
def manifest():
    return FileResponse(
        STATIC_DIR / "manifest.webmanifest",
        media_type="application/manifest+json",
    )


@router.get("/sw.js")
def service_worker():
    return FileResponse(
        STATIC_DIR / "sw.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/offline")
def offline(request: Request):
    return render(request, "offline.html")
