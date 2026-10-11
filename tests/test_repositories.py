import unittest
from unittest.mock import MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.ui import FormError
from app.db.base import Base
from app.db.models.audit import AuditLog
from app.db.models.product import Product
from app.db.models.store import Store
from app.db.models.report import Report, ReportItem
from app.db.repositories.audit import ACTIONS, audit
from app.db.repositories.products import (
    in_form,
    load_history,
    save_history,
)
from app.db.repositories.stores import check_unique_store, store_periods
from app.db.repositories.reports import (
    find_report,
    money,
    report_total,
)
from app.services.pricing import BASE_PERIOD


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)

    def tearDown(self):
        self.engine.dispose()

    def test_audit_logging(self):
        with self.Session() as db:
            req = MagicMock()
            req.client.host = "127.0.0.1"
            req.headers = {}
            audit(db, req, "admin", "admin", "вхід", "успішно")
            db.commit()

            entry = db.query(AuditLog).first()
            self.assertIsNotNone(entry)
            self.assertEqual(entry.login, "admin")
            self.assertEqual(entry.action, "вхід")
            self.assertIn("вхід", ACTIONS)

    def test_products_repository(self):
        with self.Session() as db:
            p = Product(name="Bread", price_cents=150, active=True, archived=False)
            db.add(p)
            db.flush()
            save_history(db, p.id, [(BASE_PERIOD, 150), ("2026-10", 170)])
            db.commit()

            history = load_history(db)
            self.assertIn(p.id, history)
            self.assertEqual(history[p.id], [(BASE_PERIOD, 150), ("2026-10", 170)])
            self.assertTrue(in_form(p))

            p.active = False
            self.assertFalse(in_form(p))

    def test_stores_repository(self):
        with self.Session() as db:
            s = Store(name="Store One")
            db.add(s)
            db.flush()
            r = Report(store_id=s.id, period="2026-10", status="draft")
            db.add(r)
            db.commit()

            periods = store_periods(db, s.id)
            self.assertEqual(periods, {"2026-10"})

            # Name collision raises FormError
            with self.assertRaises(FormError):
                check_unique_store(db, "Store One", "unique_login")

    def test_reports_repository(self):
        with self.Session() as db:
            s = Store(name="Shop")
            p = Product(name="Item", price_cents=500, active=True, archived=False)
            db.add_all([s, p])
            db.flush()
            save_history(db, p.id, [(BASE_PERIOD, 500)])
            r = Report(store_id=s.id, period="2026-10", status="draft")
            db.add(r)
            db.flush()
            r.items.append(ReportItem(product_id=p.id, quantity=4, unit_price_cents=500))
            db.commit()

            found = find_report(db, s.id, "2026-10")
            self.assertIsNotNone(found)
            self.assertEqual(report_total(found), 2000)
            self.assertEqual(money(2000), "20.00")


if __name__ == "__main__":
    unittest.main()
