"""Admin password change endpoint."""

from fastapi import APIRouter, Depends, Form, Request
from app.core.dependencies import admin_required, new_password
from app.core.security import hash_pw
from app.core.ui import done
from app.db.models.user import User
from app.db.repositories.audit import audit
from app.db.session import get_db
from sqlmodel import Session


router = APIRouter()


@router.post("")
def admin_password(
    request: Request,
    password: str = Form(),
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    user.password_hash = hash_pw(new_password(password))
    audit(db, request, user.login, user.role, "змінено пароль адміністратора")
    db.commit()
    return done(request, "/admin#password", "Ваш пароль змінено.")
