import os
import unittest

# Importing the application builds its signed-session middleware. Use a test-only
# key so this test never creates or depends on a local production secret file.
os.environ["SECRET_KEY"] = "unit-test-only-secret-key"

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.repositories.reports import build_lines, build_summary
from app.db.base import Base
from app.db.models.product import Product, ProductPrice
from app.db.models.report import Report, ReportItem
from app.db.models.store import Store
from app.services.pricing import BASE_PERIOD


class ReportLineIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)

    def tearDown(self):
        self.engine.dispose()

    def test_price_change_month_has_two_lines_and_correct_total(self):
        with self.Session() as db:
            store = Store(name="Test store")
            product = Product(name="Test product", price_cents=2700, active=True, archived=False)
            db.add_all([store, product])
            db.flush()
            db.add_all([
                ProductPrice(product_id=product.id, period=BASE_PERIOD, price_cents=2500),
                ProductPrice(product_id=product.id, period="2026-10", price_cents=2700),
            ])
            report = Report(store_id=store.id, period="2026-10", status="draft")
            db.add(report)
            db.flush()
            report.items.extend([
                ReportItem(product_id=product.id, quantity=2, unit_price_cents=2500),
                ReportItem(product_id=product.id, quantity=3, unit_price_cents=2700),
            ])
            db.commit()

            rows, inactive, inactive_total = build_lines(db, "2026-10", report.items)
            self.assertEqual(inactive, [])
            self.assertEqual(inactive_total, 0)
            self.assertEqual(
                [(line["price"], line["qty"], line["label"]) for line in rows[0]["inputs"]],
                [(2500, 2, "old"), (2700, 3, "new")],
            )
            self.assertEqual(rows[0]["sum"], 13100)

    def test_merged_summary_keeps_old_and_new_price_rows(self):
        with self.Session() as db:
            store = Store(name="Test store")
            product = Product(name="Test product", price_cents=2700, active=True, archived=False)
            db.add_all([store, product])
            db.flush()
            db.add_all([
                ProductPrice(product_id=product.id, period=BASE_PERIOD, price_cents=2500),
                ProductPrice(product_id=product.id, period="2026-10", price_cents=2700),
            ])
            report = Report(store_id=store.id, period="2026-10", status="draft")
            db.add(report)
            db.flush()
            report.items.extend([
                ReportItem(product_id=product.id, quantity=2, unit_price_cents=2500),
                ReportItem(product_id=product.id, quantity=3, unit_price_cents=2700),
            ])
            db.commit()

            stores, rows, store_sums, grand = build_summary(db, "2026-10")
            self.assertEqual([row["label"] for row in rows], ["old", "new"])
            self.assertEqual([row["cells"] for row in rows], [[2], [3]])
            self.assertEqual([row["sum"] for row in rows], [5000, 8100])
            self.assertEqual([store.name for store in stores], ["Test store"])
            self.assertEqual(store_sums, [13100])
            self.assertEqual(grand, 13100)

    def test_future_month_offers_only_the_new_price(self):
        with self.Session() as db:
            product = Product(name="Test product", price_cents=2700, active=True, archived=False)
            db.add(product)
            db.flush()
            db.add_all([
                ProductPrice(product_id=product.id, period=BASE_PERIOD, price_cents=2500),
                ProductPrice(product_id=product.id, period="2026-10", price_cents=2700),
            ])
            db.commit()
            rows, _, _ = build_lines(db, "2026-11", [])
            self.assertEqual([line["price"] for line in rows[0]["inputs"]], [2700])


if __name__ == "__main__":
    unittest.main()
