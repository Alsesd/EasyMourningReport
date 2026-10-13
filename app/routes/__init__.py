"""Hierarchical router composition for HTML and REST endpoints.

The versioned API is deliberately separate from legacy HTML form routes so
mobile clients and the progressive web UI can migrate without URL collisions.
"""

from fastapi import APIRouter

from app.routes.admin import admin_router
from app.routes.api_v1 import router as api_v1_router
from app.routes.auth import router as auth_router
from app.routes.pwa import router as pwa_router
from app.routes.report import router as report_router
from app.routes.root import router as root_router

public_router = APIRouter()
public_router.include_router(pwa_router)
public_router.include_router(auth_router)
public_router.include_router(root_router)

store_router = APIRouter()
store_router.include_router(report_router)

api_router = APIRouter()
api_router.include_router(public_router)
api_router.include_router(store_router)
api_router.include_router(admin_router)
api_router.include_router(api_v1_router, prefix="/api/v1")

__all__ = [
    "admin_router",
    "api_router",
    "api_v1_router",
    "auth_router",
    "public_router",
    "pwa_router",
    "report_router",
    "root_router",
    "store_router",
]
