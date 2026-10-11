"""Progressive Web App (PWA) static manifests and offline fallbacks."""

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from app.core.ui import render

router = APIRouter()
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


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
