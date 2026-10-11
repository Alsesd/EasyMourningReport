"""Hierarchical API router composition.

Route modules own endpoint behavior; this module only composes routers.
Public/authentication, store reporting, and administrator endpoints are
assembled into the application router without changing their public URLs.
"""

from fastapi import APIRouter

from app.routes.admin import admin_router
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

__all__ = [
    "admin_router",
    "api_router",
    "auth_router",
    "public_router",
    "pwa_router",
    "report_router",
    "root_router",
    "store_router",
]
