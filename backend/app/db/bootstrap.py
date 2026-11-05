"""Database initialisation: run every module's migrations, ensure built-in roles, seed a first admin."""

import os
import secrets

from sqlmodel import select

from app.core.security import hash_pw
from app.db.backup import backup_db
from app.db.base import Base
from app.db.migrations import run_migrations
from app.db.session import SessionLocal, engine
from app.platform.accounts.models import User
from app.platform.accounts.permissions import PLATFORM_ADMIN
from app.platform.accounts.service import ensure_built_in_roles
from app.platform.registry import get_registry


def migrate() -> list[str]:
    """Bring a database created by any older version up to date. A backup is taken first if anything has to change."""
    return run_migrations(engine, get_registry(), Base.metadata, backup=backup_db)


def seed() -> None:
    with SessionLocal() as db:
        roles = ensure_built_in_roles(db)
        if db.scalar(select(User.id).limit(1)):
            db.commit()
            return
        admin_pw = os.getenv("ADMIN_PASSWORD") or secrets.token_urlsafe(9)
        admin = User(login="admin", password_hash=hash_pw(admin_pw))
        admin.roles = [roles[PLATFORM_ADMIN]]
        db.add(admin)
        print(
            f"\n*** ПЕРШИЙ ЗАПУСК: логін 'admin', пароль '{admin_pw}'. "
            "Змініть його на сторінці «Налаштування». ***\n",
            flush=True,
        )
        if os.getenv("DEMO"):
            db.flush()
            for module in get_registry():
                if module.seed:
                    module.seed(db)
        db.commit()
