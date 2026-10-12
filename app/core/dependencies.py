"""FastAPI request dependencies and validators."""

import re
from decimal import Decimal, InvalidOperation

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from app.core.ui import FormError, current_period
from app.db.models.user import User
from app.db.session import get_db
from app.services.pricing import norm_login, norm_name, valid_login


def user_required(request: Request, db: Session = Depends(get_db)) -> User:
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user and user.role == "store" and (not user.store or user.store.archived):
        user = None  # archived store: the login no longer works
    if not user:
        raise HTTPException(303, headers={"Location": "/login"})
    return user


def admin_required(user: User = Depends(user_required)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Лише для адміністраторів")
    return user


def store_required(user: User = Depends(user_required)) -> User:
    if user.role != "store":
        raise HTTPException(403, "Лише для користувачів магазинів")
    return user


def parse_period(p: str | None) -> str:
    p = p or current_period()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", p):
        raise HTTPException(400, "Період має мати вигляд 2026-10")
    return p


def admin_period(request: Request, p: str | None) -> str:
    """Month for admin pages. An explicit choice is remembered, so the tabs keep showing the same month."""
    if p:
        period = parse_period(p)
        request.session["period"] = period
        return period
    return parse_period(request.session.get("period"))


def to_cents(s: str) -> int:
    try:
        d = Decimal(s.strip().replace(" ", "").replace(",", "."))
        if not d.is_finite():
            raise InvalidOperation
        cents = int((d * 100).to_integral_value())
    except (InvalidOperation, ValueError):
        raise FormError("Некоректна ціна. Приклад: 25.50")
    if cents < 0 or cents > 1_000_000_000:
        raise FormError("Некоректна ціна. Приклад: 25.50")
    return cents


def clean_name(raw: str, what: str = "Назва") -> str:
    name = norm_name(raw)
    if not name:
        raise FormError(f"{what} не може бути порожньою")
    if len(name) > 100:
        raise FormError(f"{what} задовга (до 100 символів)")
    return name


def clean_login(raw: str) -> str:
    login = norm_login(raw)
    if not valid_login(login):
        raise FormError("Логін: від 2 до 40 символів, без пробілів")
    return login


def new_password(pw: str) -> str:
    if len(pw) < 6:
        raise FormError("Пароль має бути щонайменше 6 символів")
    return pw
