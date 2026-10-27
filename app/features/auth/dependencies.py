"""FastAPI request authentication dependencies for both JSON API and HTML sessions."""

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from app.core.database import get_db
from app.features.auth.models import User


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


def user_required(request: Request, db: Session = Depends(get_db)) -> User:
    """HTML form session authentication redirecting to /login."""
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user and user.role == "store" and (not user.store or user.store.archived):
        user = None
    if not user:
        raise HTTPException(303, headers={"Location": "/login"})
    return user


def admin_required(user: User = Depends(user_required)) -> User:
    """HTML form administrator authorization."""
    if user.role != "admin":
        raise HTTPException(403, "Лише для адміністраторів")
    return user


def store_required(user: User = Depends(user_required)) -> User:
    """HTML form store authorization."""
    if user.role != "store":
        raise HTTPException(403, "Лише для користувачів магазинів")
    return user


__all__ = [
    "admin_required",
    "api_admin_required",
    "api_store_required",
    "api_user_required",
    "store_required",
    "user_required",
]
