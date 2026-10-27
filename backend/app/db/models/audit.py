"""Audit trail for authentication and business actions."""

from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"

    id: int | None = Field(default=None, primary_key=True)
    # SQLModel validates datetime fields as timezone-aware unless NaiveDatetime is used.
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)
    login: str = Field(index=True)
    role: str = Field(default="")
    action: str = Field(index=True)
    detail: str = Field(default="")
    ip: str = Field(default="")
