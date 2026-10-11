"""Audit logging repository."""

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.security import client_ip
from app.db.models.audit import AuditLog

ACTIONS = [
    "вхід",
    "невдалий вхід",
    "вихід",
    "збережено звіт",
    "надіслано звіт",
    "додано товар",
    "змінено товар",
    "змінено ціну товару",
    "архівовано товар",
    "відновлено товар",
    "видалено товар",
    "додано магазин",
    "змінено магазин",
    "архівовано магазин",
    "відновлено магазин",
    "видалено магазин",
    "змінено пароль магазину",
    "змінено пароль адміністратора",
    "заблоковано звіт",
    "розблоковано звіт",
    "завантажено резервну копію",
]


def audit(
    db: Session, request: Request, login: str, role: str, action: str, detail: str = ""
) -> None:
    """Append one row to the admin-visible action log."""
    db.add(
        AuditLog(
            login=login, role=role, action=action, detail=detail, ip=client_ip(request)
        )
    )
