"""Admin sub-router aggregating server routes (Excel export and DB backup)."""

from fastapi import APIRouter, Depends

from app.core.dependencies import admin_required
from app.routes.admin.backup import router as backup_router
from app.routes.admin.summary import router as summary_router

admin_router = APIRouter(
    dependencies=[Depends(admin_required)],
    tags=["Admin"],
)

admin_router.include_router(summary_router, prefix="/admin/summary", tags=["Admin Summary"])
admin_router.include_router(backup_router, prefix="/admin/backup", tags=["Admin Backup"])

__all__ = [
    "admin_router",
    "backup_router",
    "summary_router",
]
