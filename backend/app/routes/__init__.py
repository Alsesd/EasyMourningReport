"""Hierarchical router composition for PWA assets, auth, admin server routes, and REST API."""

from fastapi import APIRouter

from app.routes.admin import admin_router
from app.routes.api_v1 import router as api_v1_router
from app.routes.auth import router as auth_router
from app.routes.pwa import router as pwa_router

public_router = APIRouter()
public_router.include_router(pwa_router)
public_router.include_router(auth_router)

api_router = APIRouter()
api_router.include_router(public_router)
api_router.include_router(admin_router)
api_router.include_router(api_v1_router, prefix="/api/v1")

__all__ = [
    "admin_router",
    "api_router",
    "api_v1_router",
    "auth_router",
    "public_router",
    "pwa_router",
]
