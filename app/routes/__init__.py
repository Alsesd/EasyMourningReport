"""Root route aggregator for EasyMourningReport."""

from fastapi import APIRouter

from app.routes.admin import admin_router
from app.routes.auth import router as auth_router
from app.routes.pwa import router as pwa_router
from app.routes.report import router as report_router
from app.routes.root import router as root_router

api_router = APIRouter()

api_router.include_router(pwa_router)
api_router.include_router(auth_router)
api_router.include_router(root_router)
api_router.include_router(report_router)
api_router.include_router(admin_router)

__all__ = [
    "admin_router",
    "api_router",
    "auth_router",
    "pwa_router",
    "report_router",
    "root_router",
]
