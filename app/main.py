"""Compose the FastAPI application and its cross-cutting infrastructure."""

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from app.core.paths import asset_dir
from app.core.security import load_secret, same_origin_post_guard
from app.core.tailscale import shutdown as shutdown_tailscale
from app.core.ui import FormError, done, render, safe_referer
from app.db.backup import backup_db, backup_loop
from app.db.bootstrap import migrate, seed
from app.routes import api_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Initialize persistent state and run periodic backups until shutdown."""
    migrate()
    seed()
    await asyncio.to_thread(backup_db)
    backup_task = asyncio.create_task(backup_loop(), name="database-backup-loop")
    try:
        # Restore the explicitly enabled app-specific Funnel after a restart.
        await asyncio.to_thread(start_tailscale_if_enabled)
        yield
    finally:
        await asyncio.to_thread(shutdown_tailscale)
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

app.mount("/static", StaticFiles(directory=asset_dir("static")), name="static")
app.include_router(api_router)


def _is_api_request(request: Request) -> bool:
    return request.url.path == "/api/v1" or request.url.path.startswith("/api/v1/")


@app.exception_handler(FormError)
def form_error(request: Request, exc: FormError):
    """JSON API clients receive machine-readable validation errors."""
    if _is_api_request(request):
        return JSONResponse({"detail": exc.message, "code": "validation_error"}, status_code=422)
    return done(request, exc.to or safe_referer(request) or "/", exc.message, "err")


@app.exception_handler(RequestValidationError)
def invalid_form(request: Request, exc: RequestValidationError):
    """Use JSON for API validation and retain readable feedback for legacy forms."""
    if _is_api_request(request):
        errors = [
            {"loc": [str(part) for part in error.get("loc", ())], "msg": error.get("msg", "Invalid value"), "type": error.get("type", "value_error")}
            for error in exc.errors()
        ]
        return JSONResponse(
            {"detail": "Некоректні дані запиту.", "errors": errors},
            status_code=422,
        )
    if request.method == "POST":
        return done(request, safe_referer(request) or "/", "Заповніть усі поля форми.", "err")
    return render(
        request,
        "error.html",
        {"code": 400, "message": "Некоректний запит"},
        status_code=400,
    )


@app.exception_handler(StarletteHTTPException)
def http_error(request: Request, exc: StarletteHTTPException):
    """Preserve legacy redirects and use a consistent JSON error envelope for the API."""
    if _is_api_request(request):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
    location = (exc.headers or {}).get("Location")
    if location and 300 <= exc.status_code < 400:
        return RedirectResponse(location, exc.status_code)
    return render(
        request,
        "error.html",
        {"code": exc.status_code, "message": exc.detail},
        status_code=exc.status_code,
    )
