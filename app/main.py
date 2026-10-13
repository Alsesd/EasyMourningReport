"""Compose the FastAPI application and its cross-cutting infrastructure.

Business rules live in services, persistence lives in db repositories/models,
and HTTP handlers live in routes. This module intentionally only wires them
together, configures middleware, and owns application lifecycle/error handling.
"""

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import RedirectResponse
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


@app.exception_handler(FormError)
def form_error(request: Request, exc: FormError):
    """Redirect form errors back to the form that produced them."""
    return done(request, exc.to or safe_referer(request) or "/", exc.message, "err")


@app.exception_handler(RequestValidationError)
def invalid_form(request: Request, exc: RequestValidationError):
    """Return readable validation feedback instead of FastAPI's JSON detail."""
    if request.method == "POST":
        return done(
            request, safe_referer(request) or "/", "Заповніть усі поля форми.", "err"
        )
    return render(
        request,
        "error.html",
        {"code": 400, "message": "Некоректний запит"},
        status_code=400,
    )


@app.exception_handler(StarletteHTTPException)
def http_error(request: Request, exc: StarletteHTTPException):
    """Preserve redirect responses and render all other HTTP errors."""
    location = (exc.headers or {}).get("Location")
    if location and 300 <= exc.status_code < 400:
        return RedirectResponse(location, exc.status_code)
    return render(
        request,
        "error.html",
        {"code": exc.status_code, "message": exc.detail},
        status_code=exc.status_code,
    )
