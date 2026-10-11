"""Public application facade.

Importing from :mod:`app.api` is the stable entry point for ASGI servers.
Route implementation and application lifecycle remain in :mod:`app.main`.
"""
from app.main import app
from app.routes import admin_router, public_router

__all__ = ["app", "public_router", "admin_router"]
