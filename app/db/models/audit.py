"""Audit trail for authentication and business actions."""

from datetime import datetime

from sqlmodel import Field, SQLModel


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"

    id: int | None = Field(default=None, primary_key=True)
    ts: datetime = Field(default_factory=datetime.utcnow, index=True)
    login: str = Field(index=True)
    role: str = Field(default="")
    action: str = Field(index=True)
    detail: str = Field(default="")
    ip: str = Field(default="")
