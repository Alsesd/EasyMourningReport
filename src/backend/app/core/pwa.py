"""Progressive Web App (PWA) manifest and service worker from built SPA assets."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.paths import asset_dir

router = APIRouter()
pwa_router = router
STATIC_DIR = asset_dir("static") / "app"


def _built_asset(name: str):
    path = STATIC_DIR / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not Found")
    return path


@router.get("/manifest.webmanifest")
def manifest():
    return FileResponse(
        _built_asset("manifest.webmanifest"),
        media_type="application/manifest+json",
    )


@router.get("/sw.js")
def service_worker():
    return FileResponse(
        _built_asset("sw.js"),
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


__all__ = ["manifest", "pwa_router", "router", "service_worker"]
