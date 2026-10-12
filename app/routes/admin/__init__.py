"""Admin sub-router aggregating all admin modular routes."""

from fastapi import APIRouter, Depends

from app.core.dependencies import admin_required
from app.routes.admin.backup import router as backup_router
from app.routes.admin.dashboard import router as dashboard_router
from app.routes.admin.logs import router as logs_router
from app.routes.admin.products import router as products_router
from app.routes.admin.reports import router as reports_router
from app.routes.admin.security import router as security_router
from app.routes.admin.stores import router as stores_router
from app.routes.admin.summary import router as summary_router

admin_router = APIRouter(
    dependencies=[Depends(admin_required)],
    tags=["Admin"],
)

admin_router.include_router(dashboard_router, prefix="/admin", tags=["Admin Dashboard"])
admin_router.include_router(products_router, prefix="/admin/products", tags=["Admin Products"])
admin_router.include_router(stores_router, prefix="/admin/stores", tags=["Admin Stores"])
admin_router.include_router(reports_router, prefix="/admin/reports", tags=["Admin Reports"])
admin_router.include_router(summary_router, prefix="/admin/summary", tags=["Admin Summary"])
admin_router.include_router(logs_router, prefix="/admin/logs", tags=["Admin Logs"])
admin_router.include_router(security_router, prefix="/admin/password", tags=["Admin Security"])
admin_router.include_router(backup_router, prefix="/admin/backup", tags=["Admin Backup"])

__all__ = [
    "admin_router",
    "backup_router",
    "dashboard_router",
    "logs_router",
    "products_router",
    "reports_router",
    "security_router",
    "stores_router",
    "summary_router",
]
