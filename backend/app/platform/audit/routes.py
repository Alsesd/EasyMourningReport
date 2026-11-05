"""Read-only audit-log endpoints."""

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from app.db.session import get_db
from app.platform.accounts.access import Principal, require
from app.platform.accounts.permissions import AUDIT_VIEW
from app.platform.audit.models import AuditLog
from app.platform.audit.schemas import AuditLogDTO
from app.platform.registry import get_registry

router = APIRouter(tags=["Audit"])


@router.get("/admin/log-actions", response_model=list[str])
def read_log_actions(_: Principal = Depends(require(AUDIT_VIEW))) -> list[str]:
    return get_registry().audit_actions()


@router.get("/admin/logs", response_model=list[AuditLogDTO])
def read_logs(
    login: str | None = None,
    action: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    _: Principal = Depends(require(AUDIT_VIEW)),
    db: Session = Depends(get_db),
) -> list[AuditLog]:
    query = select(AuditLog)
    if login:
        query = query.where(AuditLog.login.contains(login.strip().lower()))
    if action:
        query = query.where(AuditLog.action == action)
    return list(db.scalars(query.order_by(AuditLog.id.desc()).limit(limit)).all())
