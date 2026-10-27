"""Compose the FastAPI application from lifecycle, middleware, routers, and handlers."""

import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.core.http_errors import register_exception_handlers
from app.core.lifecycle import lifespan
from app.core.paths import asset_dir
from app.core.security import load_secret, same_origin_post_guard
from app.routes import api_router
from app.routes.fallback import router as fallback_router


def create_app() -> FastAPI:
    """Build the application and register its cross-cutting infrastructure."""
    application = FastAPI(lifespan=lifespan)
    application.middleware("http")(same_origin_post_guard)
    application.add_middleware(
        SessionMiddleware,
        secret_key=load_secret(),
        https_only=os.getenv("COOKIE_SECURE") == "1",
        max_age=7 * 24 * 3600,
    )
    application.mount("/static", StaticFiles(directory=asset_dir("static")), name="static")
    application.include_router(api_router)
    # Keep the SPA catch-all last so API and PWA routes take precedence.
    application.include_router(fallback_router)
    register_exception_handlers(application)
    return application


app = create_app()
