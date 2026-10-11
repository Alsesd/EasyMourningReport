"""Store ORM model."""

from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Store(Base):
    __tablename__ = "stores"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    # Archived = "removed" without losing data: the login stops working, reports stay.
    archived: Mapped[bool] = mapped_column(default=False)
