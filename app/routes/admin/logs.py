"""Admin action log inspection endpoint."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import admin_required, get_db, render
from app.db import AuditLog, User
from app.db.repositories import ACTIONS

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
