"""Store entity."""

from sqlmodel import Field, SQLModel


class Store(SQLModel, table=True):
    __tablename__ = "stores"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    # Archive rather than delete: historical reports remain available.
    archived: bool = Field(default=False, index=True)
