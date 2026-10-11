"""Validation and status-transition tests for the store report endpoints."""

import asyncio
import os
import unittest
from unittest.mock import MagicMock

os.environ.setdefault("SECRET_KEY", "unit-test-only-secret-key")

from fastapi import Form
from fastapi.exceptions import RequestValidationError
from fastapi import HTTPException, Request
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.datastructures import FormData

from app.core.ui import FormError, current_period
from app.db.base import Base
from app.db.models.audit import AuditLog
from app.db.models.product import Product, ProductPrice
from app.db.models.report import Report, ReportItem
from app.db.models.store import Store
from app.db.models.user import User
from app.routes.report import report_page, report_save
from app.services.pricing import BASE_PERIOD


def request_with_form(rows=(), session=None):
    request = MagicMock(spec=Request)
    request.session = dict(session or {})
    request.client.host = "127.0.0.1"
    request.headers = {"host": "testserver"}
    async def get_form():
        return FormData(list(rows))
    request.form = MagicMock(side_effect=get_form)
    return request


class StoreReportEdgeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)
        with self.Session() as db:
            self.store = Store(name="Test store")
            self.product = Product(name="Bread", price_cents=100, active=True, archived=False)
            db.add_all([self.store, self.product])
            db.flush()
            db.add(ProductPrice(product_id=self.product.id, period=BASE_PERIOD, price_cents=100))
            db.flush()
            self.user = User(login="store1", password_hash="hash", role="store", store_id=self.store.id)
            db.add(self.user)
            db.commit()
            self.store_id, self.product_id, self.user_id = self.store.id, self.product.id, self.user.id

    def tearDown(self):
        self.engine.dispose()

    def test_report_page_rejects_unknown_historical_period(self):
        with self.Session() as db:
            request = request_with_form()
            response = report_page(request, "1900-01", db.get(User, self.user_id), db)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/report")
            self.assertEqual(request.session["flash"]["kind"], "err")

    def test_report_save_rejects_unknown_historical_period(self):
        with self.Session() as db:
            request = request_with_form([("period", "1900-01"), ("action", "save")])
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(report_save(request, db.get(User, self.user_id), db))
            self.assertEqual(caught.exception.status_code, 403)

    def test_report_save_rejects_submitted_report(self):
        with self.Session() as db:
            report = Report(store_id=self.store_id, period=current_period(), status="submitted")
            db.add(report)
            db.commit()
            request = request_with_form([("period", current_period()), ("action", "save")])
            with self.assertRaises(FormError) as caught:
                asyncio.run(report_save(request, db.get(User, self.user_id), db))
            self.assertIn("заблоковано", str(caught.exception))
            self.assertEqual(caught.exception.to, f"/report?period={current_period()}")

    def test_invalid_quantity_and_negative_quantity_are_rejected(self):
        with self.Session() as db:
            user = db.get(User, self.user_id)
            for raw, message in (("many", "цілим числом"), ("-1", "від'ємною")):
                request = request_with_form([
                    ("period", current_period()),
                    (f"qty_{self.product_id}_100", raw),
                    ("action", "save"),
                ])
                with self.subTest(raw=raw), self.assertRaises(FormError) as caught:
                    asyncio.run(report_save(request, user, db))
                self.assertIn(message, str(caught.exception))
                db.rollback()

    def test_unoffered_price_is_rejected_but_zero_and_unknown_fields_are_ignored(self):
        with self.Session() as db:
            user = db.get(User, self.user_id)
            request = request_with_form([
                ("period", current_period()),
                (f"qty_{self.product_id}_999", "1"),
                ("action", "save"),
            ])
            with self.assertRaises(FormError) as caught:
                asyncio.run(report_save(request, user, db))
            self.assertIn("ціни змінилися", str(caught.exception))
            db.rollback()

            request = request_with_form([
                ("period", current_period()),
                ("unexpected", "1"),
                (f"qty_{self.product_id}_999", "0"),
                ("action", "save"),
            ])
            response = asyncio.run(report_save(request, user, db))
            self.assertEqual(response.status_code, 303)
            self.assertIsNotNone(db.scalar(select(Report).where(Report.store_id == self.store_id)))

    def test_zero_quantity_saved_item_does_not_expand_allowed_price_set(self):
        with self.Session() as db:
            report = Report(store_id=self.store_id, period=current_period(), status="draft")
            db.add(report)
            db.flush()
            report.items.append(ReportItem(product_id=self.product_id, quantity=0, unit_price_cents=100))
            db.commit()
            request = request_with_form([
                ("period", current_period()),
                (f"qty_{self.product_id}_100", "2"),
                ("action", "save"),
            ])
            response = asyncio.run(report_save(request, db.get(User, self.user_id), db))
            self.assertEqual(response.status_code, 303)
            stored = db.scalar(select(Report).where(Report.store_id == self.store_id))
            self.assertEqual([(item.quantity, item.unit_price_cents) for item in stored.items], [(2, 100)])

    def test_submit_locks_report_and_audits_transition(self):
        with self.Session() as db:
            user = db.get(User, self.user_id)
            request = request_with_form([
                ("period", current_period()),
                (f"qty_{self.product_id}_100", "4"),
                ("action", "submit"),
            ])
            response = asyncio.run(report_save(request, user, db))
            self.assertEqual(response.status_code, 303)
            report = db.scalar(select(Report).where(Report.store_id == self.store_id))
            self.assertEqual(report.status, "submitted")
            self.assertEqual(report.items[0].quantity, 4)
            self.assertEqual(db.scalar(select(AuditLog.action)), "надіслано звіт")

    def test_saving_again_replaces_existing_item_and_can_clear_quantity(self):
        with self.Session() as db:
            user = db.get(User, self.user_id)
            for quantity in ("4", "0"):
                request = request_with_form([
                    ("period", current_period()),
                    (f"qty_{self.product_id}_100", quantity),
                    ("action", "save"),
                ])
                response = asyncio.run(report_save(request, user, db))
                self.assertEqual(response.status_code, 303)
            report = db.scalar(select(Report).where(Report.store_id == self.store_id))
            self.assertEqual(report.items, [])


if __name__ == "__main__":
    unittest.main()
