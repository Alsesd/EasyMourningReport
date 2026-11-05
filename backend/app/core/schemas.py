"""DTO base classes and small response shapes shared by the platform and every module."""

from pydantic import BaseModel, ConfigDict, Field


class DTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MessageDTO(DTO):
    message: str


class MutationDTO(DTO):
    id: int
    archived: bool = False
    deleted: bool = False
    message: str


class PasswordDTO(BaseModel):
    password: str = Field(min_length=6, max_length=256)
