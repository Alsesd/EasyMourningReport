"""Write entries to the audit log. Modules list the action names they use in ``Module.audit_actions``."""

from fastapi import Request
from sqlmodel import Session

from app.core.security import client_ip
from app.platform.audit.models import AuditLog

PLATFORM_ACTIONS = (
    "вхід",
    "невдалий вхід",
    "вихід",
    "змінено власний пароль",
    "додано організацію",
    "змінено організацію",
    "архівовано організацію",
    "відновлено організацію",
    "видалено організацію",
    "додано користувача",
    "змінено користувача",
    "змінено пароль користувача",
    "видалено користувача",
    "додано роль",
    "змінено роль",
    "видалено роль",
    "завантажено бекап",
    "увімкнено публічний доступ",
    "вимкнено публічний доступ",
)


def audit(
    db: Session, request: Request, login: str, role: str, action: str, detail: str = ""
) -> None:
    """Append one row to the action log; the caller commits."""
    db.add(
        AuditLog(
            login=login, role=role, action=action, detail=detail, ip=client_ip(request)
        )
    )
