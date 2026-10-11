import io
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.models.product import Product, ProductPrice
from app.db.models.report import Report, ReportItem
from app.db.models.store import Store
from app.services.excel import generate_summary_excel
from app.services.pricing import (
    BASE_PERIOD,
    line_labels,
    norm_login,
    offered_prices,
    same_name,
    valid_login,
)


class PricingServiceTests(unittest.TestCase):
    def test_multi_price_per_month(self):
        # Multiple price changes in the same month (e.g. 2500 -> 2700 -> 2900 in 2026-10)
        history = [
            (BASE_PERIOD, 2500),
            ("2026-10", 2700),
            ("2026-10_1", 2900),
        ]
        # In the month of change: offers old price (2500) and all changes in that month (2700, 2900)
        prices = offered_prices(history, "2026-10")
        self.assertEqual(prices, [2500, 2700, 2900])

        # In later months: offers only the latest price (2900)
        self.assertEqual(offered_prices(history, "2026-11"), [2900])

        # In earlier months: offers only the old price (2500)
        self.assertEqual(offered_prices(history, "2026-09"), [2500])

    def test_multi_price_labels(self):
        labels = line_labels([2500, 2700, 2900], [2400])
        self.assertEqual(
            labels,
            [(2500, "old"), (2700, "new"), (2900, "new"), (2400, "saved")],
        )

    def test_norm_and_validation(self):
        self.assertEqual(norm_login("  ADMIN  "), "admin")
        self.assertTrue(valid_login("store-1"))
        self.assertFalse(valid_login("s"))
        self.assertTrue(same_name("Хліб  Білий", "хліб білий"))


class ExcelServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)

    def tearDown(self):
        self.engine.dispose()

    def test_generate_summary_excel(self):
        with self.Session() as db:
            s = Store(name="Test Shop")
            p = Product(name="Apples", price_cents=2000, active=True)
            db.add_all([s, p])
            db.flush()
            db.add(ProductPrice(product_id=p.id, period=BASE_PERIOD, price_cents=2000))
            r = Report(store_id=s.id, period="2026-10", status="submitted")
            db.add(r)
            db.flush()
            r.items.append(ReportItem(product_id=p.id, quantity=5, unit_price_cents=2000))
            db.commit()

            stream = generate_summary_excel(db, "2026-10")
            self.assertIsInstance(stream, io.BytesIO)
            data = stream.getvalue()
            self.assertTrue(len(data) > 0)
            self.assertTrue(data.startswith(b"PK"))  # zip / xlsx header


if __name__ == "__main__":
    unittest.main()
