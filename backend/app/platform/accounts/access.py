"""Who is calling, and what they may do: the dependencies every route uses for access control.

Routes declare what they need with ``Depends(require("reports.review"))``. Data scoping
is the route's job: a principal with an organisation-scope permission may only touch
``principal.organisation_id``'s records.
"""

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from app.db.session import get_db
from app.platform.accounts.models import Role, User
from app.platform.accounts.permissions import ALL_OF_SCOPE
from app.platform.registry import get_registry


def user_scope(user: User) -> str:
    return "organisation" if user.organisation_id is not None else "platform"


def role_permissions(role: Role) -> set[str]:
    """The permission codes a role grants, limited to codes that exist and match its scope."""
    codes = get_registry().codes(role.scope)  # type: ignore[arg-type]
    if role.key in ALL_OF_SCOPE:
        return set(codes)
    return {g.permission for g in role.grants} & codes


def effective_permissions(user: User) -> frozenset[str]:
    scope = user_scope(user)
    granted: set[str] = set()
    for role in user.roles:
        if role.scope == scope:
            granted |= role_permissions(role)
    return frozenset(granted)


def can_sign_in(user: User) -> bool:
    if not user.active:
        return False
    if user.organisation_id is not None and (not user.organisation or user.organisation.archived):
        return False
    return True


@dataclass(frozen=True)
class Principal:
    user: User
    permissions: frozenset[str]

    @property
    def id(self) -> int:
        return self.user.id  # type: ignore[return-value]

    @property
    def login(self) -> str:
        return self.user.login

    @property
    def organisation_id(self) -> int | None:
        return self.user.organisation_id

    @property
    def is_platform(self) -> bool:
        return self.user.organisation_id is None

    @property
    def role_label(self) -> str:
        """Short description written to the audit log's role column."""
        return ", ".join(sorted(r.name for r in self.user.roles)) or "без ролі"

    def can(self, *codes: str) -> bool:
        return any(code in self.permissions for code in codes)


def principal_for(user: User) -> Principal:
    return Principal(user=user, permissions=effective_permissions(user))


def current_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    """The signed-in user, or a JSON 401. Disabled accounts and archived organisations are signed out."""
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if not user or not can_sign_in(user):
        raise HTTPException(status_code=401, detail="Увійдіть у систему.")
    return principal_for(user)


def require(*codes: str):
    """Dependency factory: the caller must hold at least one of ``codes``."""

    def dependency(principal: Principal = Depends(current_principal)) -> Principal:
        if not principal.can(*codes):
            raise HTTPException(status_code=403, detail="Недостатньо прав для цієї дії.")
        return principal

    dependency.__name__ = f"require_{'_or_'.join(c.replace('.', '_') for c in codes)}"
    return dependency


def require_member(*codes: str):
    """Like :func:`require`, but the caller must also belong to an organisation."""

    def dependency(principal: Principal = Depends(require(*codes))) -> Principal:
        if principal.organisation_id is None:
            raise HTTPException(status_code=403, detail="Лише для користувачів організацій.")
        return principal

    dependency.__name__ = f"require_member_{'_or_'.join(c.replace('.', '_') for c in codes)}"
    return dependency
