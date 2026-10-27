"""Last-resort SPA route for paths that are not API or static assets."""

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.paths import asset_dir

router = APIRouter()


@router.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(request: Request, full_path: str):
    """Serve the compiled SPA for client-side routes, but never mask missing API files."""
    if (
        full_path.startswith("api/")
        or full_path == "api"
        or full_path.startswith("static/")
        or full_path == "static"
    ):
        raise StarletteHTTPException(status_code=404, detail="Not Found")
    index_file = asset_dir("static") / "app" / "index.html"
    if index_file.is_file():
        return FileResponse(index_file, media_type="text/html")
    raise StarletteHTTPException(status_code=404, detail="Not Found")
