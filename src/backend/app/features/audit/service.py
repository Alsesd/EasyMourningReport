"""Audit logging service (leaf dependency)."""

from fastapi import Request
from sqlmodel import Session, select

from app.core.security import client_ip
from app.features.audit.models import AuditLog

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
    "додано відділ",
    "змінено відділ",
    "архівовано відділ",
    "відновлено відділ",
    "видалено відділ",
    "додано магазин",
    "змінено магазин",
    "архівовано магазин",
    "відновлено магазин",
    "видалено магазин",
    "змінено пароль магазину",
    "створено користувача",
    "змінено користувача",
    "видалено користувача",
    "змінено пароль адміністратора",
    "заблоковано звіт",
    "розблоковано звіт",
    "завантажено резервну копію",
]


def record_audit(
    db: Session,
    request: Request,
    login: str,
    role: str,
    action: str,
    detail: str = "",
) -> None:
    """Append one row to the admin-visible action log."""
    db.add(
        AuditLog(
            login=login,
            role=role,
            action=action,
            detail=detail,
            ip=client_ip(request),
        )
    )


def list_audit_logs(
    db: Session,
    login: str | None = None,
    action: str | None = None,
    limit: int = 200,
) -> list[AuditLog]:
    """Retrieve audit log entries with optional filtering."""
    query = select(AuditLog)
    if login:
        query = query.where(AuditLog.login.contains(login.strip().lower()))
    if action:
        query = query.where(AuditLog.action == action)
    return list(db.scalars(query.order_by(AuditLog.id.desc()).limit(limit)).all())


__all__ = [
    "ACTIONS",
    "list_audit_logs",
    "record_audit",
]
