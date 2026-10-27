"""Store entity."""

from sqlmodel import Field, SQLModel


class Store(SQLModel, table=True):
    __tablename__ = "stores"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    # Archived stores keep their historic reports and audit context.
    archived: bool = Field(default=False, index=True)
