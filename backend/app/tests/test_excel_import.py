"""Boundary and transaction tests for product Excel imports."""

import io
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.models.audit import AuditLog
from app.db.models.product import Product, ProductPrice
from app.db.models.user import User
from app.services.excel import parse_products_excel
from app.services.pricing import BASE_PERIOD


def make_xlsx(rows):
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    stream = io.BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


class ExcelImportTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)
        self.user = User(login="admin", password_hash="test", role="admin")
        self.request = MagicMock()
        self.request.client.host = "127.0.0.1"
        self.request.headers = {"host": "testserver"}
        self.request.session = {}
        with self.Session() as db:
            db.add(self.user)
            db.commit()
            db.refresh(self.user)

    def tearDown(self):
        self.engine.dispose()

    def test_header_imports_products_and_skips_normalized_duplicates(self):
        payload = make_xlsx([
            ["Name", "Price"],
            ["Bread", 1.25],
            [" Bread ", 9.99],
            ["Milk", 2],
            [None, None],
        ])
        with self.Session() as db:
            response = parse_products_excel(payload, db, self.user, self.request)
            self.assertEqual(response.status_code, 303)
            self.assertIn("додано 2 товарів", self.request.session["flash"]["text"])
            self.assertEqual(
                [(p.name, p.price_cents) for p in db.scalars(select(Product).order_by(Product.name))],
                [("Bread", 125), ("Milk", 200)],
            )
            prices = list(db.scalars(select(ProductPrice).order_by(ProductPrice.product_id)))
            self.assertEqual(len(prices), 2)
            self.assertTrue(all(p.period == BASE_PERIOD for p in prices))
            self.assertEqual(db.scalar(select(AuditLog.action)), "масово додано товари")

    def test_existing_products_are_skipped_without_duplicate_audit(self):
        with self.Session() as db:
            db.add(Product(name="Bread", price_cents=125))
            db.commit()
            response = parse_products_excel(
                make_xlsx([["Bread", 2], ["Bread", 3]]), db, self.user, self.request
            )
            self.assertEqual(response.status_code, 303)
            self.assertIn("усі 2 рядків уже існують", self.request.session["flash"]["text"])
            self.assertEqual(len(list(db.scalars(select(Product)))), 1)
            self.assertEqual(len(list(db.scalars(select(AuditLog)))), 0)

    def test_corrupt_workbook_returns_user_facing_400(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as caught:
                parse_products_excel(b"not an xlsx workbook", db, self.user, self.request)
            self.assertEqual(caught.exception.status_code, 400)
            self.assertIn("коректний .xlsx", caught.exception.detail)

    def test_empty_workbook_has_specific_error(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as caught:
                parse_products_excel(make_xlsx([["Name", "Price"]]), db, self.user, self.request)
            self.assertEqual(caught.exception.status_code, 400)
            self.assertIn("немає товарів", caught.exception.detail)

    def test_invalid_rows_abort_the_whole_import_and_limit_error_details(self):
        rows = [["Invalid product", None] for _ in range(22)]
        with self.Session() as db:
            with self.assertRaises(HTTPException) as caught:
                parse_products_excel(make_xlsx(rows), db, self.user, self.request)
            self.assertEqual(caught.exception.status_code, 400)
            self.assertIn("Імпорт скасовано", caught.exception.detail)
            self.assertIn("рядок 1", caught.exception.detail)
            self.assertNotIn("рядок 22", caught.exception.detail)
            self.assertEqual(len(list(db.scalars(select(Product)))), 0)

    def test_explicit_http_exception_from_workbook_loader_is_preserved(self):
        with self.Session() as db, patch("app.services.excel.load_workbook", side_effect=HTTPException(418, "loader error")):
            with self.assertRaises(HTTPException) as caught:
                parse_products_excel(b"payload", db, self.user, self.request)
            self.assertEqual(caught.exception.status_code, 418)
            self.assertEqual(caught.exception.detail, "loader error")

    def test_boolean_price_is_rejected(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as caught:
                parse_products_excel(make_xlsx([["Bread", True]]), db, self.user, self.request)
            self.assertEqual(caught.exception.status_code, 400)
            self.assertIn("не вказана ціна", caught.exception.detail)

    def test_existing_products_are_compared_after_whitespace_normalization(self):
        with self.Session() as db:
            db.add(Product(name="White Bread", price_cents=125))
            db.commit()
            parse_products_excel(
                make_xlsx([["White   Bread", 2], ["Milk", 1]]), db, self.user, self.request
            )
            self.assertEqual(
                [p.name for p in db.scalars(select(Product).order_by(Product.name))],
                ["Milk", "White Bread"],
            )

    def test_database_failure_rolls_back_import(self):
        with self.Session() as db:
            original_flush = db.flush
            calls = 0
            def fail_on_flush(*args, **kwargs):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise RuntimeError("simulated insert failure")
                return original_flush(*args, **kwargs)
            db.flush = fail_on_flush
            with self.assertRaisesRegex(RuntimeError, "simulated insert failure"):
                parse_products_excel(make_xlsx([["Bread", 1]]), db, self.user, self.request)
            db.flush = original_flush
            db.rollback()
            self.assertEqual(len(list(db.scalars(select(Product)))), 0)


if __name__ == "__main__":
    unittest.main()
