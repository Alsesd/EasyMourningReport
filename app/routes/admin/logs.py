"""Admin action log inspection endpoint."""

from fastapi import APIRouter, Depends, Request
from app.core.dependencies import admin_required
from app.core.ui import render
from app.db.models.audit import AuditLog
from app.db.models.user import User
from app.db.repositories.audit import ACTIONS
from app.db.session import get_db
from sqlmodel import select
from sqlmodel import Session


router = APIRouter()


@router.get("")
def logs_page(
    request: Request,
    login: str | None = None,
    action: str | None = None,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    q = select(AuditLog)
    if login:
        q = q.where(AuditLog.login.contains(login.strip().lower()))
    if action:
        q = q.where(AuditLog.action == action)
    logs = db.scalars(q.order_by(AuditLog.id.desc()).limit(200)).all()
    ctx = {
        "user": user,
        "logs": logs,
        "actions": ACTIONS,
        "login": login or "",
        "action": action or "",
    }
    return render(request, "logs.html", ctx)
