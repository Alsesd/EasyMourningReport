"""Shared SQLModel metadata for every persistent entity.

SQLModel is built on SQLAlchemy, so existing SQLAlchemy Core queries and
Session-based repositories continue to work while model declarations move to
SQLModel. Keep this alias temporarily to avoid a risky all-at-once import churn.
"""

from sqlmodel import SQLModel

Base = SQLModel

__all__ = ["Base", "SQLModel"]
