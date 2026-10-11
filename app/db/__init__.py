"""Database package for EasyMourningReport.

Provides declarative Base, SQLite engine, session factory, models, repositories,
migrations, and backup utilities.
"""

from app.db import backup, bootstrap, repositories
from app.db.backup import backup_db, backup_loop
from app.db.base import Base
from app.db.bootstrap import migrate, seed
from app.db.models import (
    AuditLog,
    Product,
    ProductPrice,
    Report,
    ReportItem,
    Store,
    User,
)
from app.db.repositories.audit import audit
from app.db.session import BASE_DIR, DB_PATH, SessionLocal, engine, get_db

__all__ = [
    "AuditLog",
    "BASE_DIR",
    "Base",
    "DB_PATH",
    "Product",
    "ProductPrice",
    "Report",
    "ReportItem",
    "SessionLocal",
    "Store",
    "User",
    "audit",
    "backup",
    "backup_db",
    "backup_loop",
    "bootstrap",
    "engine",
    "get_db",
    "migrate",
    "repositories",
    "seed",
]
