"""Helpers for tests: create accounts with built-in roles without going through the API."""

from sqlmodel import Session

from app.core.security import hash_pw
from app.platform.accounts.models import Organisation, User
from app.platform.accounts.permissions import PLATFORM_ADMIN, STORE
from app.platform.accounts.service import ensure_built_in_roles


def make_admin(db: Session, login: str = "admin", password: str = "admin123") -> User:
    roles = ensure_built_in_roles(db)
    user = User(login=login, password_hash=hash_pw(password))
    user.roles = [roles[PLATFORM_ADMIN]]
    db.add(user)
    db.flush()
    return user


def make_organisation(db: Session, name: str, archived: bool = False) -> Organisation:
    org = Organisation(name=name, archived=archived)
    db.add(org)
    db.flush()
    return org


def make_member(
    db: Session,
    organisation: Organisation,
    login: str,
    password: str = "store123",
    role_key: str = STORE,
    active: bool = True,
) -> User:
    roles = ensure_built_in_roles(db)
    user = User(
        login=login, password_hash=hash_pw(password), organisation_id=organisation.id, active=active
    )
    user.roles = [roles[role_key]]
    db.add(user)
    db.flush()
    return user
