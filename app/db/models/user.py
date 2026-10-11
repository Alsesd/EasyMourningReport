"""Authentication identity and store assignment."""

from __future__ import annotations

from sqlmodel import Field, Relationship, SQLModel

if False:  # pragma: no cover - typing-only relationship target
    from app.db.models.store import Store


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)
    login: str = Field(unique=True, index=True)
    password_hash: str
    role: str = Field(index=True)  # "admin" | "store"
    store_id: int | None = Field(default=None, foreign_key="stores.id", index=True)
    store: Store | None = Relationship()
