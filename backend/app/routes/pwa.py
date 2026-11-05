"""Progressive Web App files, the offline fallback page and the container health probe."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.core.paths import asset_dir
from app.db.session import engine

router = APIRouter()
STATIC_DIR = asset_dir("static")


@router.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@router.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@router.get("/offline", include_in_schema=False)
def offline():
    return FileResponse(STATIC_DIR / "offline.html", media_type="text/html")


@router.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    """Liveness for Docker: the process answers and the database is reachable."""
    with engine.connect() as conn:
        conn.exec_driver_sql("SELECT 1")
    return {"status": "ok"}
