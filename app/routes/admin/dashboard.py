"""Admin settings shell; product/store state is fetched as typed REST DTOs."""

from fastapi import APIRouter, Depends, Request
from sqlmodel import Session

from app.core.dependencies import admin_required
from app.core.ui import render
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter()


@router.get("")
def admin_page(
    request: Request,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    # Keep the request-scoped DB dependency for compatibility with direct callers;
    # catalogue and store data are now supplied by /api/v1/admin/*.
    return render(request, "admin.html", {"user": user})
