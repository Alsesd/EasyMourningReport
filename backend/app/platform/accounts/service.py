"""Account rules shared by the routes: who may manage whom, which roles they may hand out."""

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from app.core.errors import FormError
from app.core.text import same_name
from app.platform.accounts.access import Principal, role_permissions
from app.platform.accounts.models import Organisation, Role, RolePermission, User, UserRole
from app.platform.accounts.permissions import (
    BUILT_IN_ROLES,
    ORG_USERS_MANAGE,
    PLATFORM_ADMIN,
    USERS_MANAGE,
)
from app.platform.registry import get_registry


def ensure_built_in_roles(db: Session) -> dict[str, Role]:
    """Create any missing built-in role and give newly created ones their modules' default grants."""
    existing = {r.key: r for r in db.scalars(select(Role).where(Role.key.is_not(None)))}
    defaults: dict[str, set[str]] = {}
    for module in get_registry():
        for key, codes in module.default_grants.items():
            defaults.setdefault(key, set()).update(codes)
    for key, name, scope in BUILT_IN_ROLES:
        if key in existing:
            continue
        role = Role(key=key, name=name, scope=scope)
        db.add(role)
        db.flush()
        for code in sorted(defaults.get(key, ())):
            role.grants.append(RolePermission(role_id=role.id, permission=code))
        existing[key] = role
    db.flush()
    return existing


def role_by_key(db: Session, key: str) -> Role:
    role = db.scalar(select(Role).where(Role.key == key))
    if role is None:
        role = ensure_built_in_roles(db)[key]
    return role


# --- who may manage which accounts -------------------------------------------------


def managed_organisation(principal: Principal) -> int | None:
    """The organisation an org-level manager is limited to; ``None`` for platform managers."""
    if principal.can(USERS_MANAGE):
        return None
    if principal.can(ORG_USERS_MANAGE) and principal.organisation_id is not None:
        return principal.organisation_id
    raise HTTPException(status_code=403, detail="Недостатньо прав для цієї дії.")


def check_can_manage_user(principal: Principal, user: User) -> None:
    limit = managed_organisation(principal)
    if limit is not None and user.organisation_id != limit:
        raise HTTPException(status_code=404, detail="Користувача не знайдено.")


def resolve_target_organisation(
    db: Session, principal: Principal, organisation_id: int | None
) -> Organisation | None:
    limit = managed_organisation(principal)
    if limit is not None:
        organisation_id = limit  # org managers always create users in their own organisation
    if organisation_id is None:
        return None
    org = db.get(Organisation, organisation_id)
    if not org:
        raise HTTPException(status_code=404, detail="Організацію не знайдено.")
    return org


def assignable_roles(db: Session, principal: Principal, organisation_id: int | None) -> list[Role]:
    """Roles the caller may give to a user of ``organisation_id`` (``None`` = platform staff)."""
    if organisation_id is None:
        query = select(Role).where(Role.scope == "platform")
    else:
        query = select(Role).where(
            Role.scope == "organisation",
            (Role.organisation_id.is_(None)) | (Role.organisation_id == organisation_id),
        )
    roles = list(db.scalars(query.order_by(Role.name)))
    if principal.can(USERS_MANAGE):
        return roles
    # Organisation managers may only hand out what they hold themselves.
    return [r for r in roles if role_permissions(r) <= principal.permissions]


def resolve_roles(
    db: Session, principal: Principal, organisation_id: int | None, role_ids: list[int]
) -> list[Role]:
    allowed = {r.id: r for r in assignable_roles(db, principal, organisation_id)}
    chosen = []
    for rid in dict.fromkeys(role_ids):
        if rid not in allowed:
            raise FormError("Цю роль не можна призначити цьому користувачеві.")
        chosen.append(allowed[rid])
    return chosen


def check_unique_login(db: Session, login: str, user_id: int | None = None) -> None:
    other = db.scalar(select(User).where(User.login == login, User.id != (user_id or 0)))
    if other:
        raise FormError(
            f"Логін «{login}» уже зайнятий. Логіни не залежать від регістру: Store1 і store1 — той самий."
        )


def check_unique_organisation(db: Session, name: str, organisation_id: int | None = None) -> None:
    for org in db.scalars(select(Organisation)):
        if org.id != organisation_id and same_name(org.name, name):
            raise FormError(
                f"Організація з назвою «{org.name}» уже існує"
                + (" (в архіві)" if org.archived else "")
            )


def active_platform_admins(db: Session) -> int:
    return db.scalar(
        select(func.count(func.distinct(User.id)))
        .select_from(User)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(Role.key == PLATFORM_ADMIN, User.active, User.organisation_id.is_(None))
    ) or 0


def check_admin_remains(db: Session) -> None:
    """Call after flushing a change: at least one active administrator must be left."""
    db.flush()
    if active_platform_admins(db) < 1:
        raise FormError("Має залишитися хоча б один активний адміністратор.")
