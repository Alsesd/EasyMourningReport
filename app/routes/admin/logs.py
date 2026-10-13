"""Admin action log page shell; log rows and filter options come from REST DTOs."""

from fastapi import APIRouter, Depends, Request
from sqlmodel import Session

from app.core.dependencies import admin_required
from app.core.ui import render
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter()


@router.get("")
def logs_page(
    request: Request,
    login: str | None = None,
    action: str | None = None,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    return render(
        request,
        "logs.html",
        {"user": user, "login": login or "", "action": action or ""},
    )
