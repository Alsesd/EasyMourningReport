"""Compose every router: PWA assets, legacy form sign-in, then each module's REST API under /api/v1."""

from fastapi import APIRouter

from app.platform.accounts.auth import router as form_auth_router
from app.platform.registry import get_registry
from app.routes.pwa import router as pwa_router


def build_api_router() -> APIRouter:
    router = APIRouter()
    router.include_router(pwa_router)
    router.include_router(form_auth_router)
    for module in get_registry():
        if module.router is not None:
            router.include_router(module.router, prefix="/api/v1")
    return router


api_router = build_api_router()

__all__ = ["api_router", "build_api_router"]
