"""Typed API schemas for user administration."""

from typing import Literal

from pydantic import BaseModel, Field

from app.core.schemas import DTO


class UserDTO(DTO):
    id: int
    name: str
    login: str
    role: Literal["admin", "store"]
    department_id: int | None = None
    department_name: str | None = None
    permissions: list[str] = Field(default_factory=list)


class DepartmentUserDTO(DTO):
    id: int
    name: str
    login: str
    permissions: list[str] = Field(default_factory=list)


class UserCreateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    login: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=6, max_length=256)
    department_id: int | None = None
    department_name: str | None = Field(default=None, max_length=100)
    permissions: list[str] = Field(min_length=1)


class UserUpdateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    login: str = Field(min_length=2, max_length=40)
    password: str | None = Field(default=None, min_length=6, max_length=256)
    department_id: int | None = None
    department_name: str | None = Field(default=None, max_length=100)
    permissions: list[str] = Field(min_length=1)


__all__ = ["DepartmentUserDTO", "UserCreateDTO", "UserDTO", "UserUpdateDTO"]
