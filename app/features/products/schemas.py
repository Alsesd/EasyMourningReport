"""Typed API schemas for products and pricing."""

from pydantic import BaseModel, Field

from app.core.schemas import DTO, MutationDTO


class PricePointDTO(DTO):
    period: str
    price_cents: int


class ProductDTO(DTO):
    id: int
    name: str
    price_cents: int
    active: bool
    archived: bool
    used_count: int = 0
    month_prices_cents: list[int] = Field(default_factory=list)
    price_history: list[PricePointDTO] = Field(default_factory=list)


class ProductCreateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    price: str = Field(min_length=1, max_length=30)


class ProductUpdateDTO(ProductCreateDTO):
    active: bool


class ImportResultDTO(DTO):
    message: str


__all__ = [
    "ImportResultDTO",
    "MutationDTO",
    "PricePointDTO",
    "ProductCreateDTO",
    "ProductDTO",
    "ProductUpdateDTO",
]
