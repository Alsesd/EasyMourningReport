"""Application-level exceptions shared by request handlers and services."""


class FormError(Exception):
    """A user-correctable input error, returned to the client as HTTP 422 with ``detail``."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message
