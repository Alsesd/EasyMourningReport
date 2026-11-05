"""Schema upgrades for databases created by older releases of the reports feature."""

from sqlalchemy.engine import Connection

from app.core.modules import Migration
from app.db.migrations import columns, table_names
from app.modules.reports.models import ProductPrice, ReportSettings
from app.modules.reports.pricing import BASE_PERIOD


def legacy_columns(conn: Connection) -> None:
    """Columns and tables added before modules existed (archiving, statuses, price history)."""
    tables = table_names(conn)
    if "reports" in tables and "status" not in columns(conn, "reports"):
        conn.exec_driver_sql("ALTER TABLE reports ADD COLUMN status VARCHAR NOT NULL DEFAULT 'draft'")
    if "products" in tables and "archived" not in columns(conn, "products"):
        conn.exec_driver_sql("ALTER TABLE products ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0")
    if "report_items" in tables and "quantity_calc" not in columns(conn, "report_items"):
        conn.exec_driver_sql(
            "ALTER TABLE report_items ADD COLUMN quantity_calc INTEGER NOT NULL DEFAULT 0"
        )
    if "products" in tables:
        ProductPrice.__table__.create(conn, checkfirst=True)  # type: ignore[attr-defined]
        # Every product needs a starting price record.
        conn.exec_driver_sql(
            "INSERT INTO product_prices (product_id, period, price_cents) "
            f"SELECT id, '{BASE_PERIOD}', price_cents FROM products "
            "WHERE id NOT IN (SELECT product_id FROM product_prices)"
        )


def settings_table(conn: Connection) -> None:
    """Move the per-store "По розрахунку" flag off the shared organisations table."""
    ReportSettings.__table__.create(conn, checkfirst=True)  # type: ignore[attr-defined]
    org_table = "organisations" if "organisations" in table_names(conn) else "stores"
    if "calculation_enabled" not in columns(conn, org_table):
        return
    conn.exec_driver_sql(
        "INSERT OR IGNORE INTO report_settings (organisation_id, calculation_enabled) "
        f"SELECT id, calculation_enabled FROM {org_table} WHERE calculation_enabled"
    )
    conn.exec_driver_sql(f"ALTER TABLE {org_table} DROP COLUMN calculation_enabled")


MIGRATIONS = (
    Migration("reports.0001_legacy_columns", legacy_columns),
    Migration("reports.0002_settings_table", settings_table),
)
