"""AuditLog ORM model."""

from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    login: Mapped[str]
    role: Mapped[str] = mapped_column(default="")
    action: Mapped[str]
    detail: Mapped[str] = mapped_column(default="")
    ip: Mapped[str] = mapped_column(default="")
