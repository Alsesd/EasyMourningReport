"""Application-level exceptions shared by request handlers and services."""


class FormError(Exception):
    """A user-correctable form or input error."""

    def __init__(self, message: str, to: str | None = None):
        super().__init__(message)
        self.message = message
        self.to = to
