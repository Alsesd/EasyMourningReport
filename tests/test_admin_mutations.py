"""Boundary and failure-path tests for product and store administration."""

import asyncio
import io
import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "unit-test-only-secret-key")

from fastapi import HTTPException, Request, UploadFile
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.ui import FormError, current_period
from app.db.base import Base
from app.db.models.product import Product, ProductPrice
from app.db.models.store import Store
from app.db.models.user import User
from app.routes.admin.products import product_add, product_delete, product_edit, product_import, product_restore
from app.routes.admin.stores import store_add, store_delete, store_edit, store_password, store_restore
from app.services.pricing import BASE_PERIOD, offered_prices


def make_request(form_fields=()):
    request = MagicMock(spec=Request)
    request.session = {}
    request.client.host = "127.0.0.1"
    request.headers = {"host": "testserver"}
    async def get_form():
        from starlette.datastructures import FormData
        return FormData(list(form_fields))
    request.form = MagicMock(side_effect=get_form)
    return request


class AdminMutationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)
        with self.Session() as db:
            self.admin = User(login="admin", password_hash="hash", role="admin")
            self.store = Store(name="Existing store")
            db.add_all([self.admin, self.store])
            db.flush()
            self.store_user = User(login="shop1", password_hash="hash", role="store", store_id=self.store.id)
            self.product = Product(name="Bread", price_cents=100, active=True, archived=False)
            db.add_all([self.store_user, self.product])
            db.flush()
            db.add(ProductPrice(product_id=self.product.id, period=BASE_PERIOD, price_cents=100))
            db.commit()
            self.admin_id, self.store_id = self.admin.id, self.store.id
            self.store_user_id, self.product_id = self.store_user.id, self.product.id

    def tearDown(self):
        self.engine.dispose()

    def test_single_price_change_same_price_and_revert(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            req = make_request([("name", "Bread"), ("price", "2.00"), ("active", "on")])
            response = asyncio.run(product_edit(req, self.product_id, admin, db))
            self.assertEqual(response.status_code, 303)
            product = db.get(Product, self.product_id)
            self.assertEqual(offered_prices([(BASE_PERIOD, 100), (f"{current_period()}", 200)], current_period()), [100, 200])

            req_same = make_request([("name", "Bread"), ("price", "2.00"), ("active", "on")])
            response = asyncio.run(product_edit(req_same, self.product_id, admin, db))
            self.assertEqual(req_same.session["flash"]["kind"], "info")
            self.assertIn("Змін немає", req_same.session["flash"]["text"])

            req_revert = make_request([("name", "Bread"), ("price", "1.00"), ("active", "on")])
            asyncio.run(product_edit(req_revert, self.product_id, admin, db))
            history = [(row.period, row.price_cents) for row in db.scalars(select(ProductPrice).where(ProductPrice.product_id == self.product_id))]
            self.assertEqual(history, [(BASE_PERIOD, 100)])
            self.assertIn("скасовано", req_revert.session["flash"]["text"])

    def test_product_edit_changes_name_and_toggles_active_state_both_ways(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            request = make_request([("name", "Fresh Bread"), ("price", "1.00")])
            response = asyncio.run(product_edit(request, self.product_id, admin, db))
            self.assertEqual(response.status_code, 303)
            product = db.get(Product, self.product_id)
            self.assertEqual(product.name, "Fresh Bread")
            self.assertFalse(product.active)
            self.assertIn("вимкнено", request.session["flash"]["text"])

            request = make_request([("name", "Fresh Bread"), ("price", "1.00"), ("active", "on")])
            response = asyncio.run(product_edit(request, self.product_id, admin, db))
            self.assertEqual(response.status_code, 303)
            self.assertTrue(product.active)
            self.assertIn("увімкнено", request.session["flash"]["text"])

    def test_product_edit_rejects_missing_archived_and_price_less_forms(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            with self.assertRaises(HTTPException) as missing:
                asyncio.run(product_edit(make_request(), 9999, admin, db))
            self.assertEqual(missing.exception.status_code, 404)
            product = db.get(Product, self.product_id)
            product.archived = True
            db.commit()
            with self.assertRaises(HTTPException) as archived:
                asyncio.run(product_edit(make_request(), self.product_id, admin, db))
            self.assertEqual(archived.exception.status_code, 404)
            product.archived = False
            db.commit()
            request = make_request([("name", "Bread"), ("active", "on")])
            with self.assertRaises(HTTPException) as no_price:
                asyncio.run(product_edit(request, self.product_id, admin, db))
            self.assertEqual(no_price.exception.status_code, 400)

    def test_product_delete_missing_id_returns_404(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as caught:
                product_delete(make_request(), 12345, db.get(User, self.admin_id), db)
            self.assertEqual(caught.exception.status_code, 404)

    def test_product_restore_missing_id_returns_404(self):
        from app.routes.admin.products import product_restore
        with self.Session() as db:
            with self.assertRaises(HTTPException) as caught:
                product_restore(make_request(), 12345, db.get(User, self.admin_id), db)
            self.assertEqual(caught.exception.status_code, 404)

    def test_product_import_checks_extension_size_and_empty_payload(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            with self.assertRaises(HTTPException) as extension:
                asyncio.run(product_import(make_request(), UploadFile(filename="products.csv", file=io.BytesIO(b"x")), admin, db))
            self.assertEqual(extension.exception.status_code, 400)
            with self.assertRaises(HTTPException) as empty:
                asyncio.run(product_import(make_request(), UploadFile(filename="products.xlsx", file=io.BytesIO(b"")), admin, db))
            self.assertEqual(empty.exception.status_code, 400)
            oversized = UploadFile(filename="products.xlsx", file=io.BytesIO(b"x" * (10 * 1024 * 1024 + 1)))
            with self.assertRaises(HTTPException) as large:
                asyncio.run(product_import(make_request(), oversized, admin, db))
            self.assertEqual(large.exception.status_code, 400)

    def test_product_import_passes_bounded_workbook_to_service(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            sentinel = object()
            with patch("app.routes.admin.products.parse_products_excel", return_value=sentinel) as parser:
                response = asyncio.run(product_import(
                    make_request(), UploadFile(filename="products.xlsx", file=io.BytesIO(b"valid-ish")), admin, db
                ))
            self.assertIs(response, sentinel)
            self.assertEqual(parser.call_args.args[0], b"valid-ish")

    def test_store_edit_noop_and_missing_store_user(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            req = make_request()
            response = store_edit(req, self.store_id, "Existing store", "shop1", admin, db)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(req.session["flash"]["kind"], "info")

            orphan = Store(name="Store without login")
            db.add(orphan)
            db.commit()
            with self.assertRaises(HTTPException) as missing_user:
                store_edit(make_request(), orphan.id, "Renamed", "other", admin, db)
            self.assertEqual(missing_user.exception.status_code, 404)
            with self.assertRaises(HTTPException) as missing_store:
                store_edit(make_request(), 98765, "Renamed", "other", admin, db)
            self.assertEqual(missing_store.exception.status_code, 404)

    def test_store_password_and_restore_missing_ids_return_404(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            with self.assertRaises(HTTPException) as deleted:
                store_delete(make_request(), 98765, admin, db)
            self.assertEqual(deleted.exception.status_code, 404)
            with self.assertRaises(HTTPException) as password:
                store_password(make_request(), 98765, "password123", admin, db)
            self.assertEqual(password.exception.status_code, 404)
            with self.assertRaises(HTTPException) as restore:
                store_restore(make_request(), 98765, admin, db)
            self.assertEqual(restore.exception.status_code, 404)

    def test_store_add_integrity_error_rolls_back_and_becomes_form_error(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            with patch("app.routes.admin.stores.check_unique_store"):
                with self.assertRaises(FormError):
                    store_add(make_request(), "Existing store", "another-login", "password123", admin, db)
            self.assertEqual(len(list(db.scalars(select(Store).where(Store.name == "Existing store")))), 1)

    def test_store_edit_integrity_error_rolls_back_and_becomes_form_error(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            second = Store(name="Second store")
            db.add(second)
            db.flush()
            second_user = User(login="shop2", password_hash="hash", role="store", store_id=second.id)
            db.add(second_user)
            db.commit()
            with patch("app.routes.admin.stores.check_unique_store"):
                with self.assertRaises(FormError):
                    store_edit(make_request(), second.id, "Existing store", "shop2", admin, db)
            db.expire_all()
            self.assertEqual(db.get(Store, second.id).name, "Second store")


if __name__ == "__main__":
    unittest.main()
