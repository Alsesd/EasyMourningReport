"""Authentication identity and store assignment."""

from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.features.stores.models import Store


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)
    login: str = Field(unique=True, index=True)
    password_hash: str
    role: str = Field(index=True)  # "admin" | "store"
    store_id: int | None = Field(
        default=None, foreign_key="stores.id", index=True
    )
    store: Optional["Store"] = Relationship()


__all__ = ["User"]
