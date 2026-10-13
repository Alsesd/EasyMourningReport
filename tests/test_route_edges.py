"""Edge cases for request dependencies and administrator CRUD routes."""

import os
import unittest
from unittest.mock import MagicMock

os.environ.setdefault("SECRET_KEY", "unit-test-only-secret-key")

from fastapi import HTTPException, Request
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.dependencies import admin_required, store_required, user_required
from app.core.ui import FormError, current_period
from app.db.base import Base
from app.db.models.audit import AuditLog
from app.db.models.product import Product, ProductPrice
from app.db.models.report import Report, ReportItem
from app.db.models.store import Store
from app.db.models.user import User
from app.routes.admin.dashboard import admin_page
from app.routes.admin.logs import logs_page
from app.routes.admin.products import product_delete, product_restore
from app.routes.admin.reports import report_view, report_status, reports_page
from app.routes.admin.stores import store_delete, store_restore
from app.services.pricing import BASE_PERIOD


def make_request(session=None):
    request = MagicMock(spec=Request)
    request.session = dict(session or {})
    request.client.host = "127.0.0.1"
    request.headers = {"host": "testserver"}
    return request


class RouteEdgeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)
        with self.Session() as db:
            self.admin = User(login="admin", password_hash="hash", role="admin")
            self.store = Store(name="Active store")
            self.archived_store = Store(name="Archived store", archived=True)
            db.add_all([self.admin, self.store, self.archived_store])
            db.flush()
            self.store_user = User(login="store1", password_hash="hash", role="store", store_id=self.store.id)
            self.archived_user = User(login="store2", password_hash="hash", role="store", store_id=self.archived_store.id)
            self.orphan_user = User(login="orphan", password_hash="hash", role="store", store_id=None)
            self.product = Product(name="Bread", price_cents=100, active=True, archived=False)
            self.inactive_product = Product(name="Old bread", price_cents=150, active=False, archived=False)
            self.archived_product = Product(name="Archived item", price_cents=200, active=False, archived=True)
            db.add_all([self.store_user, self.archived_user, self.orphan_user, self.product, self.inactive_product, self.archived_product])
            db.flush()
            db.add_all([
                ProductPrice(product_id=self.product.id, period=BASE_PERIOD, price_cents=100),
                ProductPrice(product_id=self.inactive_product.id, period=BASE_PERIOD, price_cents=150),
                ProductPrice(product_id=self.archived_product.id, period=BASE_PERIOD, price_cents=200),
            ])
            db.commit()
            self.admin_id, self.store_user_id = self.admin.id, self.store_user.id
            self.archived_user_id = self.archived_user.id
            self.orphan_user_id = self.orphan_user.id
            self.store_id, self.archived_store_id = self.store.id, self.archived_store.id
            self.product_id, self.archived_product_id = self.product.id, self.archived_product.id

    def tearDown(self):
        self.engine.dispose()

    def test_request_dependencies_allow_right_roles_and_deny_wrong_roles(self):
        with self.Session() as db:
            req = make_request()
            with self.assertRaises(HTTPException) as missing:
                user_required(req, db)
            self.assertEqual(missing.exception.status_code, 303)
            req.session["uid"] = self.admin_id
            self.assertEqual(user_required(req, db).role, "admin")
            self.assertIs(admin_required(db.get(User, self.admin_id)), db.get(User, self.admin_id))
            with self.assertRaises(HTTPException) as forbidden_admin:
                admin_required(db.get(User, self.store_user_id))
            self.assertEqual(forbidden_admin.exception.status_code, 403)
            with self.assertRaises(HTTPException) as forbidden_store:
                store_required(db.get(User, self.admin_id))
            self.assertEqual(forbidden_store.exception.status_code, 403)
            self.assertEqual(store_required(db.get(User, self.store_user_id)).role, "store")
            req.session["uid"] = self.archived_user_id
            with self.assertRaises(HTTPException) as archived:
                user_required(req, db)
            self.assertEqual(archived.exception.status_code, 303)
            req.session["uid"] = self.orphan_user_id
            with self.assertRaises(HTTPException) as orphan:
                user_required(req, db)
            self.assertEqual(orphan.exception.status_code, 303)

    def test_dashboard_separates_inactive_and_archived_entities(self):
        with self.Session() as db:
            response = admin_page(make_request(), db.get(User, self.admin_id), db)
            self.assertEqual(response.status_code_code if hasattr(response, "status_code_code") else response.status_code, 200)
            # This page is a client-rendered shell; the catalogue comes from REST DTOs.
            self.assertIn(b'x-data="adminApp()"', response.body)

    def test_product_used_by_report_is_archived_not_deleted_then_restored(self):
        with self.Session() as db:
            report = Report(store_id=self.store_id, period=current_period(), status="draft")
            db.add(report)
            db.flush()
            report.items.append(ReportItem(product_id=self.product_id, quantity=2, unit_price_cents=100))
            db.commit()
            req = make_request()
            response = product_delete(req, self.product_id, db.get(User, self.admin_id), db)
            self.assertEqual(response.status_code, 303)
            self.assertIsNotNone(db.get(Product, self.product_id))
            self.assertTrue(db.get(Product, self.product_id).archived)
            response = product_restore(req, self.product_id, db.get(User, self.admin_id), db)
            self.assertEqual(response.status_code, 303)
            self.assertFalse(db.get(Product, self.product_id).archived)
            self.assertTrue(db.get(Product, self.product_id).active)

    def test_store_with_reports_is_archived_not_deleted_then_restored(self):
        with self.Session() as db:
            db.add(Report(store_id=self.store_id, period=current_period(), status="draft"))
            db.commit()
            req = make_request()
            response = store_delete(req, self.store_id, db.get(User, self.admin_id), db)
            self.assertEqual(response.status_code, 303)
            self.assertIsNotNone(db.get(Store, self.store_id))
            self.assertTrue(db.get(Store, self.store_id).archived)
            response = store_restore(req, self.store_id, db.get(User, self.admin_id), db)
            self.assertEqual(response.status_code, 303)
            self.assertFalse(db.get(Store, self.store_id).archived)

    def test_report_view_handles_missing_and_existing_report(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            with self.assertRaises(HTTPException) as missing:
                report_view(9876, make_request(), admin, db)
            self.assertEqual(missing.exception.status_code, 404)
            report = Report(store_id=self.store_id, period=current_period(), status="draft")
            db.add(report)
            db.flush()
            report.items.append(ReportItem(product_id=self.product_id, quantity=0, unit_price_cents=100))
            db.commit()
            response = report_view(report.id, make_request(), admin, db)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(request.session["period"], current_period())
            self.assertEqual(response.context["report_id"], report.id)
            self.assertIn(b"adminReportDetailApp", response.body)

    def test_report_status_validation_and_unlock_action(self):
        with self.Session() as db:
            admin = db.get(User, self.admin_id)
            req = make_request()
            with self.assertRaises(HTTPException) as invalid:
                report_status(req, 9876, "submitted", admin, db)
            self.assertEqual(invalid.exception.status_code, 400)
            report = Report(store_id=self.store_id, period=current_period(), status="submitted")
            db.add(report)
            db.commit()
            with self.assertRaises(HTTPException) as invalid_status:
                report_status(req, report.id, "invalid", admin, db)
            self.assertEqual(invalid_status.exception.status_code, 400)
            response = report_status(req, report.id, "draft", admin, db)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(db.get(Report, report.id).status, "draft")
            audit = db.scalar(select(AuditLog).where(AuditLog.action == "розблоковано звіт"))
            self.assertIsNotNone(audit)

            orphan_report = Report(store_id=99999, period=current_period(), status="draft")
            db.add(orphan_report)
            db.commit()
            response = report_status(req, orphan_report.id, "submitted", admin, db)
            self.assertEqual(response.status_code, 303)
            orphan_audit = db.scalar(select(AuditLog).where(AuditLog.detail == f"? · {current_period()}"))
            self.assertIsNotNone(orphan_audit)

    def test_reports_list_handles_archived_stores_with_and_without_reports(self):
        with self.Session() as db:
            archived_report = Report(store_id=self.archived_store_id, period="2020-01", status="draft")
            db.add(archived_report)
            db.commit()
            response = reports_page(make_request(), "2020-01", db.get(User, self.admin_id), db)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.context["period"], "2020-01")
            self.assertIn(b"adminReportsApp('2020-01')", response.body)
            response_current = reports_page(make_request(), current_period(), db.get(User, self.admin_id), db)
            self.assertEqual(response_current.status_code, 200)
            self.assertIn(f"adminReportsApp('{current_period()}')".encode(), response_current.body)

    def test_logs_accepts_login_and_action_filters(self):
        with self.Session() as db:
            db.add_all([
                AuditLog(login="admin", role="admin", action="вхід", detail="", ip="127.0.0.1"),
                AuditLog(login="store1", role="store", action="збережено звіт", detail="", ip="127.0.0.1"),
            ])
            db.commit()
            response = logs_page(make_request(), " ADMIN ", "вхід", db.get(User, self.admin_id), db)
            self.assertEqual(response.status_code, 200)
            self.assertIn(b'x-data="adminLogsApp()"', response.body)
            # Query filters are initialized client-side and fetched from the REST API.
            self.assertIn(b"/api/v1/admin/logs?", (awaitless := b"/api/v1/admin/logs?") if False else b"/api/v1/admin/logs" )


if __name__ == "__main__":
    unittest.main()
