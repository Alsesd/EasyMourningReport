"""Admin password change endpoint."""

from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy.orm import Session

from app.core import admin_required, done, get_db, hash_pw, new_password
from app.db import User, audit

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
