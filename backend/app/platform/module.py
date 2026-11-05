"""The platform described with the same contract as feature modules, so it is composed the same way."""

from fastapi import APIRouter

from app.core.modules import Module
from app.platform.accounts.migrations import MIGRATIONS
from app.platform.accounts.models import Organisation, Role, RolePermission, User, UserRole
from app.platform.accounts.permissions import PLATFORM_PERMISSIONS
from app.platform.accounts.routes import router as accounts_router
from app.platform.accounts.session_routes import router as session_router
from app.platform.audit.models import AuditLog
from app.platform.audit.routes import router as audit_router
from app.platform.audit.service import PLATFORM_ACTIONS
from app.platform.overview import router as overview_router
from app.platform.system.routes import router as system_router

router = APIRouter()
router.include_router(session_router)
router.include_router(accounts_router)
router.include_router(audit_router)
router.include_router(system_router)
router.include_router(overview_router)

module = Module(
    name="platform",
    title="Платформа",
    router=router,
    permissions=PLATFORM_PERMISSIONS,
    models=(Organisation, User, Role, RolePermission, UserRole, AuditLog),
    migrations=MIGRATIONS,
    audit_actions=PLATFORM_ACTIONS,
)
