"""Transport-order DTOs."""

from app.core.schemas import DTO


class TransportStatusDTO(DTO):
    ready: bool
    message: str
