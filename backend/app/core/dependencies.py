"""Request validators shared by the platform and modules."""

import re
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException

from app.core.errors import FormError
from app.core.periods import current_period
from app.core.text import norm_login, norm_name, valid_login


def parse_period(p: str | None) -> str:
    p = p or current_period()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", p):
        raise HTTPException(400, "Період має мати вигляд 2026-10")
    return p


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
