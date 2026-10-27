"""FastAPI request authentication and role authorization dependencies."""

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from app.core.database import get_db
from app.features.auth.models import User
from app.features.auth.permissions import decode_permissions


def api_user_required(
    request: Request, db: Session = Depends(get_db)
) -> User:
    """Authenticate using signed session cookie, returning JSON 401 on error."""
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user and user.role == "store" and (not user.store or user.store.archived):
        user = None
    if not user:
        raise HTTPException(status_code=401, detail="Увійдіть у систему.")
    return user


def api_admin_required(user: User = Depends(api_user_required)) -> User:
    """Authorize administrator role, returning JSON 403 on error."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Лише для адміністраторів.")
    return user


def api_store_required(user: User = Depends(api_user_required)) -> User:
    """Authorize store role, returning JSON 403 on error."""
    if user.role != "store":
        raise HTTPException(status_code=403, detail="Лише для користувачів магазинів.")
    return user


def api_permission_required(permission: str):
    """Build a dependency that requires one permission code for a store user."""

    def dependency(user: User = Depends(api_store_required)) -> User:
        if permission not in decode_permissions(user.permissions, user.role):
            raise HTTPException(
                status_code=403,
                detail="Ваш обліковий запис не має доступу до цього розділу.",
            )
        return user

    return dependency


__all__ = [
    "api_admin_required",
    "api_permission_required",
    "api_store_required",
    "api_user_required",
]
