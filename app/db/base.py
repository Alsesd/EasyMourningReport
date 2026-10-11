"""Shared SQLModel metadata for all persistent entities.

SQLModel is built on SQLAlchemy, so existing SQLAlchemy query expressions and
Session-based repositories remain compatible during the incremental migration.
"""

from sqlmodel import SQLModel

Base = SQLModel

__all__ = ["Base", "SQLModel"]
