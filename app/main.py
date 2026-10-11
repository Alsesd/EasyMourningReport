"""Main FastAPI application entrypoint.

Initializes FastAPI with lifespan management, session and CSRF middleware,
exception handlers, static file mounting, and modular routes.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from app.core.security import load_secret, same_origin_post_guard
from app.core.ui import FormError, done, render, safe_referer
from app.db.backup import backup_db, backup_loop
from app.db.bootstrap import migrate, seed
from app.routes import api_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    migrate()
    seed()
    await asyncio.to_thread(backup_db)
    backup_task = asyncio.create_task(backup_loop(), name="database-backup-loop")
    try:
        yield
    finally:
        backup_task.cancel()
        try:
            await backup_task
        except asyncio.CancelledError:
            pass
        # Backup I/O can be slow; don't block the event loop during shutdown.
        await asyncio.to_thread(backup_db)


app = FastAPI(lifespan=lifespan)

# Mount global CSRF protection middleware on POST endpoints
app.middleware("http")(same_origin_post_guard)

app.add_middleware(
    SessionMiddleware,
    secret_key=load_secret(),
    https_only=os.getenv("COOKIE_SECURE") == "1",
    max_age=7 * 24 * 3600,
)

# Static files / PWA assets
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Include all modular endpoints
app.include_router(api_router)


# Exception handlers
@app.exception_handler(FormError)
def form_error(request: Request, exc: FormError):
    return done(request, exc.to or safe_referer(request) or "/", exc.message, "err")


@app.exception_handler(RequestValidationError)
def invalid_form(request: Request, exc: RequestValidationError):
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
    location = (exc.headers or {}).get("Location")
    if location and 300 <= exc.status_code < 400:
        return RedirectResponse(location, exc.status_code)
    return render(
        request,
        "error.html",
        {"code": exc.status_code, "message": exc.detail},
        status_code=exc.status_code,
    )
