"""Compose the FastAPI application and its vertical feature slices."""

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from app.core.backup import backup_db, backup_loop, backup_router
from app.core.bootstrap import migrate, seed
from app.core.paths import asset_dir
from app.core.pwa import pwa_router
from app.core.security import load_secret, same_origin_post_guard
from app.core.ui import FormError, done, render, safe_referer
from app.features.audit.router import router as audit_router
from app.features.auth.router import public_router as public_auth_router
from app.features.auth.router import router as auth_router
from app.features.products.router import router as products_router
from app.features.reports.router import (
    router as reports_router,
)
from app.features.reports.router import (
    summary_xlsx_router,
)
from app.features.stores.router import router as stores_router
from app.features.tunnel.router import router as tunnel_router
from app.features.tunnel.service import (
    shutdown as shutdown_tunnel,
)
from app.features.tunnel.service import (
    start_if_enabled as start_tunnel_if_enabled,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Initialize persistent state, run periodic backups, and manage tunnel."""
    migrate()
    seed()
    await asyncio.to_thread(backup_db)
    backup_task = asyncio.create_task(
        backup_loop(), name="database-backup-loop"
    )
    try:
        await asyncio.to_thread(start_tunnel_if_enabled)
        yield
    finally:
        await asyncio.to_thread(shutdown_tunnel)
        backup_task.cancel()
        try:
            await backup_task
        except asyncio.CancelledError:
            pass
        await asyncio.to_thread(backup_db)


app = FastAPI(lifespan=lifespan)
app.middleware("http")(same_origin_post_guard)
app.add_middleware(
    SessionMiddleware,
    secret_key=load_secret(),
    https_only=os.getenv("COOKIE_SECURE") == "1",
    max_age=7 * 24 * 3600,
)

# Static assets
app.mount("/static", StaticFiles(directory=asset_dir("static")), name="static")

# Public, PWA, and server-rendered download routers
app.include_router(pwa_router)
app.include_router(public_auth_router)
app.include_router(backup_router)
app.include_router(summary_xlsx_router)

# Vertical domain feature slices under /api/v1
app.include_router(auth_router, prefix="/api/v1")
app.include_router(products_router, prefix="/api/v1")
app.include_router(stores_router, prefix="/api/v1")
app.include_router(reports_router, prefix="/api/v1")
app.include_router(audit_router, prefix="/api/v1")
app.include_router(tunnel_router, prefix="/api/v1")


def _is_api_request(request: Request) -> bool:
    return request.url.path == "/api/v1" or request.url.path.startswith(
        "/api/v1/"
    )


@app.exception_handler(FormError)
def form_error(request: Request, exc: FormError):
    """JSON API clients receive machine-readable validation errors."""
    if _is_api_request(request):
        return JSONResponse(
            {"detail": exc.message, "code": "validation_error"}, status_code=422
        )
    return done(
        request, exc.to or safe_referer(request) or "/", exc.message, "err"
    )


@app.exception_handler(RequestValidationError)
def invalid_form(request: Request, exc: RequestValidationError):
    """Use JSON for API validation and retain readable feedback for server-rendered forms."""
    if _is_api_request(request):
        errors = [
            {
                "loc": [str(part) for part in error.get("loc", ())],
                "msg": error.get("msg", "Invalid value"),
                "type": error.get("type", "value_error"),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            {"detail": "Некоректні дані запиту.", "errors": errors},
            status_code=422,
        )
    if request.method == "POST":
        return done(
            request,
            safe_referer(request) or "/",
            "Заповніть усі поля форми.",
            "err",
        )
    return render(
        request,
        "error.html",
        {"code": 400, "message": "Некоректний запит"},
        status_code=400,
    )


@app.exception_handler(StarletteHTTPException)
def http_error(request: Request, exc: StarletteHTTPException):
    """Preserve redirects and use a consistent JSON error envelope for the API."""
    if _is_api_request(request):
        return JSONResponse(
            {"detail": exc.detail},
            status_code=exc.status_code,
            headers=exc.headers,
        )
    location = (exc.headers or {}).get("Location")
    if location and 300 <= exc.status_code < 400:
        return RedirectResponse(location, exc.status_code)
    return render(
        request,
        "error.html",
        {"code": exc.status_code, "message": exc.detail},
        status_code=exc.status_code,
    )


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str):
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


__all__ = ["app", "migrate", "seed"]
