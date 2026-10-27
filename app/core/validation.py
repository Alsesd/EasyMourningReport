"""Cross-cutting validation and value-normalisation helpers."""

import re
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException

from app.core.ui import FormError, current_period


def norm_name(raw: str) -> str:
    return " ".join((raw or "").split())


def parse_period(period: str | None) -> str:
    period = period or current_period()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
        raise HTTPException(400, "Період має мати вигляд 2026-10")
    return period


def to_cents(raw: str) -> int:
    try:
        value = Decimal(raw.strip().replace(" ", "").replace(",", "."))
        if not value.is_finite():
            raise InvalidOperation
        cents = int((value * 100).to_integral_value())
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


__all__ = [
    "clean_name",
    "norm_name",
    "parse_period",
    "to_cents",
]
