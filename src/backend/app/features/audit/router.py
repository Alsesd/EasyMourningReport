"""Audit log REST API endpoints."""

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.core.database import get_db
from app.features.audit.models import AuditLog
from app.features.audit.schemas import AuditLogDTO
from app.features.audit.service import ACTIONS, list_audit_logs
from app.features.auth.dependencies import api_admin_required
from app.features.auth.models import User

router = APIRouter(tags=["Audit"])


@router.get("/admin/log-actions", response_model=list[str])
def read_admin_log_actions(
    _: User = Depends(api_admin_required),
) -> list[str]:
    return ACTIONS


@router.get("/admin/logs", response_model=list[AuditLogDTO])
def read_admin_logs(
    login: str | None = None,
    action: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> list[AuditLog]:
    return list_audit_logs(db=db, login=login, action=action, limit=limit)


__all__ = ["router"]
