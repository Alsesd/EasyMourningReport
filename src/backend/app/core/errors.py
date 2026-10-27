"""Domain-level validation errors surfaced by the JSON API."""


class DomainError(Exception):
    """A request contains a value that violates a domain rule."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


__all__ = ["DomainError"]
