"""Typed API schemas for authentication and session management."""

from typing import Literal

from pydantic import BaseModel, Field

from app.core.schemas import DTO


class PasswordDTO(BaseModel):
    password: str = Field(min_length=6, max_length=256)


class StorePasswordDTO(PasswordDTO):
    pass


class LoginDTO(BaseModel):
    login: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class MessageDTO(DTO):
    message: str


class SessionDTO(DTO):
    login: str
    name: str
    role: Literal["admin", "store"]
    store_id: int | None = None
    store_name: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    permissions: list[str] = Field(default_factory=list)
    period: str


__all__ = [
    "DTO",
    "LoginDTO",
    "MessageDTO",
    "PasswordDTO",
    "SessionDTO",
    "StorePasswordDTO",
]
