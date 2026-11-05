"""The administration overview: account counts, system health, recent activity and module figures."""

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlmodel import Session, select

from app.core.schemas import DTO
from app.db.session import get_db
from app.platform.accounts.access import Principal, current_principal
from app.platform.accounts.models import Organisation, Role, User
from app.platform.accounts.permissions import (
    AUDIT_VIEW,
    ORG_USERS_MANAGE,
    ORGANISATIONS_MANAGE,
    ROLES_MANAGE,
    SYSTEM_MANAGE,
    USERS_MANAGE,
)
from app.platform.audit.models import AuditLog
from app.platform.audit.schemas import AuditLogDTO
from app.platform.registry import get_registry
import app.platform.system.tunnel as tunnel
from app.platform.system.health import health
from app.platform.system.schemas import SystemHealthDTO, TunnelStatusDTO

router = APIRouter(tags=["Administration"])


class AccountsSummaryDTO(DTO):
    organisations: int
    archived_organisations: int
    users: int
    inactive_users: int
    roles: int


class OverviewStatDTO(DTO):
    label: str
    value: str
    hint: str = ""
    section: str = ""


class ModuleOverviewDTO(DTO):
    module: str
    title: str
    stats: list[OverviewStatDTO]


class AdminOverviewDTO(DTO):
    accounts: AccountsSummaryDTO | None = None
    tunnel: TunnelStatusDTO | None = None
    health: SystemHealthDTO | None = None
    recent_activity: list[AuditLogDTO] | None = None
    modules: list[ModuleOverviewDTO] = []


def _count(db: Session, query) -> int:
    return db.scalar(query) or 0


def _accounts(db: Session, principal: Principal) -> AccountsSummaryDTO | None:
    if principal.can(USERS_MANAGE, ORGANISATIONS_MANAGE, ROLES_MANAGE):
        users = select(func.count(User.id))
        return AccountsSummaryDTO(
            organisations=_count(db, select(func.count(Organisation.id)).where(Organisation.archived.is_(False))),
            archived_organisations=_count(db, select(func.count(Organisation.id)).where(Organisation.archived)),
            users=_count(db, users),
            inactive_users=_count(db, users.where(User.active.is_(False))),
            roles=_count(db, select(func.count(Role.id))),
        )
    if principal.can(ORG_USERS_MANAGE) and principal.organisation_id is not None:
        own = select(func.count(User.id)).where(User.organisation_id == principal.organisation_id)
        return AccountsSummaryDTO(
            organisations=1,
            archived_organisations=0,
            users=_count(db, own),
            inactive_users=_count(db, own.where(User.active.is_(False))),
            roles=0,
        )
    return None


@router.get("/admin/overview", response_model=AdminOverviewDTO)
def read_overview(
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
) -> AdminOverviewDTO:
    """Everything the caller may see; sections they have no permission for are omitted."""
    result = AdminOverviewDTO(accounts=_accounts(db, principal))
    if principal.can(SYSTEM_MANAGE):
        result.tunnel = TunnelStatusDTO(**tunnel.status())
        result.health = health()
    if principal.can(AUDIT_VIEW):
        latest = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(6))
        result.recent_activity = [AuditLogDTO.model_validate(row) for row in latest]
    for module in get_registry():
        if module.overview is None:
            continue
        stats = module.overview(db, principal)
        if stats:
            result.modules.append(
                ModuleOverviewDTO(
                    module=module.name,
                    title=module.title,
                    stats=[OverviewStatDTO(label=s.label, value=s.value, hint=s.hint, section=s.section) for s in stats],
                )
            )
    return result
