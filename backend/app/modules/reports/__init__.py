"""Monthly store reports: product catalogue with price history, report entry, review and summary."""

from app.core.modules import Module
from app.modules.reports.migrations import MIGRATIONS
from app.modules.reports.models import Product, ProductPrice, Report, ReportItem, ReportSettings
from app.modules.reports.permissions import AUDIT_ACTIONS, PERMISSIONS, SUBMIT
from app.modules.reports.reports_repo import reports_per_organisation
from app.modules.reports.routes import router
from app.modules.reports.seed import seed_demo

module = Module(
    name="reports",
    title="Звіти",
    router=router,
    permissions=PERMISSIONS,
    models=(Product, ProductPrice, Report, ReportItem, ReportSettings),
    migrations=MIGRATIONS,
    audit_actions=AUDIT_ACTIONS,
    default_grants={"store": (SUBMIT,)},
    organisation_usage=reports_per_organisation,
    seed=seed_demo,
)
