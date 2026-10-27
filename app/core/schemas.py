"""Shared response envelopes used across feature slices."""

from pydantic import BaseModel, ConfigDict


class DTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MutationDTO(DTO):
    id: int | None = None
    deleted: bool = False
    archived: bool = False
    message: str = ""


__all__ = ["DTO", "MutationDTO"]
