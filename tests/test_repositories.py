import unittest
from unittest.mock import MagicMock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.core.ui import FormError, money
from app.features.audit.models import AuditLog
from app.features.audit.service import ACTIONS
from app.features.audit.service import record_audit as audit
from app.features.products.models import Product
from app.features.products.service import (
    BASE_PERIOD,
    in_form,
    load_history,
    save_history,
)
from app.features.reports.models import Report, ReportItem
from app.features.reports.service import (
    build_lines,
    build_summary,
    find_report,
    report_total,
    store_periods,
)
from app.features.stores.models import Store
from app.features.stores.service import check_unique_store


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


    def test_save_history_updates_existing_deletes_stale_and_adds_new_rows(self):
        with self.Session() as db:
            product = Product(name="History test", price_cents=100)
            db.add(product)
            db.flush()
            db.add_all([
                __import__("app.features.products.models", fromlist=["ProductPrice"]).ProductPrice(
                    product_id=product.id, period=BASE_PERIOD, price_cents=100
                ),
                __import__("app.features.products.models", fromlist=["ProductPrice"]).ProductPrice(
                    product_id=product.id, period="2026-10", price_cents=125
                ),
            ])
            db.commit()
            save_history(db, product.id, [(BASE_PERIOD, 110), ("2026-11", 140)])
            db.commit()
            history = load_history(db)[product.id]
            self.assertEqual(history, [(BASE_PERIOD, 110), ("2026-11", 140)])

    def test_archived_store_name_and_duplicate_login_are_rejected(self):
        with self.Session() as db:
            store = Store(name="Old Store", archived=True)
            user = __import__("app.features.auth.models", fromlist=["User"]).User(
                login="taken-login", password_hash="hash", role="store"
            )
            db.add_all([store, user])
            db.commit()
            with self.assertRaisesRegex(FormError, "в архіві"):
                check_unique_store(db, " old   store ", "other-login")
            with self.assertRaisesRegex(FormError, "уже зайнятий"):
                check_unique_store(db, "Different Store", "taken-login")
            # Editing the matching records must not conflict with themselves.
            check_unique_store(
                db, "Old Store", "taken-login", store_id=store.id, user_id=user.id
            )

    def test_empty_store_periods_and_archived_product_form_visibility(self):
        with self.Session() as db:
            store = Store(name="No reports")
            archived = Product(name="Archived but active", price_cents=100, active=True, archived=True)
            db.add_all([store, archived])
            db.commit()
            self.assertEqual(store_periods(db, store.id), set())
            self.assertFalse(in_form(archived))

    def test_build_lines_keeps_saved_lines_for_inactive_and_archived_products(self):
        with self.Session() as db:
            store = Store(name="Shop")
            inactive = Product(name="Inactive", price_cents=100, active=False, archived=False)
            archived = Product(name="Archived", price_cents=200, active=True, archived=True)
            active_no_history = Product(name="No history", price_cents=300, active=True, archived=False)
            db.add_all([store, inactive, archived, active_no_history])
            db.flush()
            report = Report(store_id=store.id, period="2026-10", status="draft")
            db.add(report)
            db.flush()
            report.items.extend([
                ReportItem(product_id=inactive.id, quantity=2, unit_price_cents=100),
                ReportItem(product_id=archived.id, quantity=3, unit_price_cents=200),
            ])
            db.commit()
            rows, inactive_rows, inactive_total = build_lines(db, "2026-10", report.items)
            self.assertEqual([row["name"] for row in rows], ["No history"])
            self.assertEqual([row["name"] for row in inactive_rows], ["Archived", "Inactive"])
            self.assertEqual(inactive_total, 800)

    def test_summary_filter_includes_archived_data_only_when_submitted(self):
        with self.Session() as db:
            current_store = Store(name="Current store")
            archived_store = Store(name="Archived store", archived=True)
            current_product = Product(name="Current product", price_cents=100, active=True, archived=False)
            archived_product = Product(name="Archived product", price_cents=200, active=False, archived=True)
            db.add_all([current_store, archived_store, current_product, archived_product])
            db.flush()
            submitted = Report(store_id=archived_store.id, period="2026-10", status="submitted")
            draft = Report(store_id=current_store.id, period="2026-10", status="draft")
            db.add_all([submitted, draft])
            db.flush()
            submitted.items.append(ReportItem(product_id=archived_product.id, quantity=2, unit_price_cents=200))
            submitted.items.append(ReportItem(product_id=current_product.id, quantity=0, unit_price_cents=100))
            draft.items.append(ReportItem(product_id=current_product.id, quantity=5, unit_price_cents=100))
            db.commit()
            stores, rows, sums, grand = build_summary(db, "2026-10", submitted_only=True)
            self.assertEqual([s.name for s in stores], ["Archived store", "Current store"])
            self.assertEqual([r["name"] for r in rows], ["Archived product", "Current product"])
            self.assertEqual(sums, [400, 0])
            self.assertEqual(grand, 400)


if __name__ == "__main__":
    unittest.main()
