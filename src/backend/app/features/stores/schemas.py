"""Typed API schemas for stores management."""

from pydantic import BaseModel, Field

from app.core.schemas import DTO, MutationDTO


class StoreDTO(DTO):
    id: int
    name: str
    login: str
    archived: bool
    reports_count: int = 0


class StoreCreateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    login: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=6, max_length=256)


class StoreUpdateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    login: str = Field(min_length=2, max_length=40)


__all__ = [
    "MutationDTO",
    "StoreCreateDTO",
    "StoreDTO",
    "StoreUpdateDTO",
]
