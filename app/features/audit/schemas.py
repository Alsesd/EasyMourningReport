"""Audit log DTOs."""

from datetime import datetime

from app.core.schemas import DTO


class AuditLogDTO(DTO):
    id: int
    ts: datetime
    login: str
    role: str
    action: str
    detail: str
    ip: str


__all__ = ["AuditLogDTO"]
