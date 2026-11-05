"""Figures the reports module adds to the administration overview."""

from sqlalchemy import func
from sqlmodel import Session, select

from app.core.modules import OverviewStat
from app.core.periods import current_period
from app.modules.reports.models import Product, Report
from app.modules.reports.permissions import CATALOG_MANAGE, REVIEW
from app.platform.accounts.models import Organisation


def overview(db: Session, principal) -> list[OverviewStat]:
    stats: list[OverviewStat] = []
    if principal.can(REVIEW):
        period = current_period()
        stores = db.scalar(select(func.count(Organisation.id)).where(Organisation.archived.is_(False))) or 0
        submitted = db.scalar(
            select(func.count(Report.id)).where(Report.period == period, Report.status == "submitted")
        ) or 0
        drafts = db.scalar(
            select(func.count(Report.id)).where(Report.period == period, Report.status == "draft")
        ) or 0
        stats.append(OverviewStat("Надіслано звітів за місяць", f"{submitted} / {stores}", f"чернеток: {drafts}"))
    if principal.can(CATALOG_MANAGE):
        active = db.scalar(
            select(func.count(Product.id)).where(Product.active, Product.archived.is_(False))
        ) or 0
        archived = db.scalar(select(func.count(Product.id)).where(Product.archived)) or 0
        stats.append(OverviewStat("Активних товарів", str(active), f"в архіві: {archived}", section="products"))
    return stats
