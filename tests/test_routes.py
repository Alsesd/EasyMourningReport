import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock
from urllib.parse import urlencode

os.environ["SECRET_KEY"] = "unit-test-only-secret-key"

from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.datastructures import FormData

from app.db.base import Base
from app.db.models.product import Product, ProductPrice
from app.db.models.store import Store
from app.db.models.user import User
from app.db.models.report import Report
from app.core.security import hash_pw
from app.main import app
from app.core.dependencies import get_db
from app.core.ui import current_period
from app.services.pricing import BASE_PERIOD

from app.routes.root import index
from app.routes.auth import logout
from app.routes.admin.dashboard import admin_page
from app.routes.admin.products import (
    product_add,
    product_delete,
    product_edit,
)
from app.routes.admin.stores import (
    store_add,
    store_delete,
    store_edit,
    store_password,
)
from app.routes.admin.reports import reports_page, report_status
from app.routes.admin.summary import summary_page, summary_xlsx
from app.routes.admin.logs import logs_page
from app.routes.admin.security import admin_password
from app.routes.report import report_page, report_save


def run_asgi(app_instance, method="GET", path="/", query="", headers=None, body=b""):
    headers_dict = dict(headers or {})
    headers_dict.setdefault("host", "testserver")
    headers_list = [
        (k.lower().encode(), v.encode()) for k, v in headers_dict.items()
    ]
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "query_string": query.encode(),
        "headers": headers_list,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    sent = []
    body_sent = False

    async def receive():
        nonlocal body_sent
        if not body_sent:
            body_sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    async def execute():
        await app_instance(scope, receive, send)

    asyncio.run(execute())

    status = next(
        (m["status"] for m in sent if m["type"] == "http.response.start"), None
    )
    resp_headers = {
        k.decode(): v.decode()
        for m in sent
        if m["type"] == "http.response.start"
        for k, v in m.get("headers", [])
    }
    body_bytes = b"".join(
        m.get("body", b"") for m in sent if m["type"] == "http.response.body"
    )
    return SimpleNamespace(
        status_code=status,
        headers=resp_headers,
        body=body_bytes,
        text=body_bytes.decode(errors="ignore"),
    )


class RouteIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)

        def override_get_db():
            with self.Session() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db

        with self.Session() as db:
            self.admin_user = User(
                login="admin", password_hash=hash_pw("admin123"), role="admin"
            )
            self.store = Store(name="Route Test Store")
            db.add_all([self.admin_user, self.store])
            db.flush()
            self.store_user = User(
                login="storeuser",
                password_hash=hash_pw("store123"),
                role="store",
                store_id=self.store.id,
            )
            self.product = Product(name="Test Bread", price_cents=150, active=True)
            db.add_all([self.store_user, self.product])
            db.flush()
            db.add(
                ProductPrice(
                    product_id=self.product.id, period=BASE_PERIOD, price_cents=150
                )
            )
            db.commit()
            self.admin_id = self.admin_user.id
            self.store_user_id = self.store_user.id
            self.store_id = self.store.id
            self.product_id = self.product.id

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    def _mock_request(self, session=None, form_data=None):
        req = MagicMock(spec=Request)
        req.session = session if session is not None else {}
        req.client.host = "127.0.0.1"
        req.headers = {"host": "testserver"}
        if form_data:
            req.form = MagicMock()
            async def get_form():
                return FormData(form_data)
            req.form.side_effect = get_form
        return req

    def test_pwa_routes(self):
        resp = run_asgi(app, "GET", "/manifest.webmanifest")
        self.assertEqual(resp.status_code, 200)

        resp = run_asgi(app, "GET", "/sw.js")
        self.assertEqual(resp.status_code, 200)

        resp = run_asgi(app, "GET", "/offline")
        self.assertEqual(resp.status_code, 200)

    def test_csrf_guard_blocks_unauthorized_post(self):
        # Missing Origin and Referer -> 403 Forbidden
        resp = run_asgi(app, "POST", "/login", body=b"login=admin&password=wrong")
        self.assertEqual(resp.status_code, 403)

        # Cross-origin -> 403 Forbidden
        headers = {"host": "testserver", "origin": "http://evil.com"}
        resp = run_asgi(
            app,
            "POST",
            "/login",
            headers=headers,
            body=b"login=admin&password=wrong",
        )
        self.assertEqual(resp.status_code, 403)

    def test_auth_login_flow(self):
        headers = {
            "host": "testserver",
            "origin": "http://testserver",
            "content-type": "application/x-www-form-urlencoded",
        }
        # Invalid credentials -> 401
        body = urlencode({"login": "admin", "password": "wrong"}).encode()
        resp = run_asgi(app, "POST", "/login", headers=headers, body=body)
        self.assertEqual(resp.status_code, 401)

        # Valid credentials -> 303 Redirect
        body = urlencode({"login": "admin", "password": "admin123"}).encode()
        resp = run_asgi(app, "POST", "/login", headers=headers, body=body)
        self.assertEqual(resp.status_code, 303)
        self.assertEqual(resp.headers.get("location"), "/")
        self.assertIn("set-cookie", resp.headers)

    def test_unauthorized_routes_redirect_to_login(self):
        resp = run_asgi(app, "GET", "/")
        self.assertEqual(resp.status_code, 303)
        self.assertEqual(resp.headers.get("location"), "/login")

        resp = run_asgi(app, "GET", "/report")
        self.assertEqual(resp.status_code, 303)
        self.assertEqual(resp.headers.get("location"), "/login")

        resp = run_asgi(app, "GET", "/admin")
        self.assertEqual(resp.status_code, 303)
        self.assertEqual(resp.headers.get("location"), "/login")

    def test_root_and_auth_endpoints(self):
        with self.Session() as db:
            admin_user = db.get(User, self.admin_id)
            store_user = db.get(User, self.store_user_id)
            # Root index redirection for admin and store
            resp_admin = index(admin_user)
            self.assertEqual(resp_admin.headers["location"], "/admin")
            resp_store = index(store_user)
            self.assertEqual(resp_store.headers["location"], "/report")

            # Logout
            req = self._mock_request(session={"uid": self.admin_id})
            resp = logout(req, db)
            self.assertEqual(resp.status_code, 303)
            self.assertEqual(resp.headers["location"], "/login")
            self.assertEqual(req.session, {})

    def test_admin_dashboard_and_products_endpoints(self):
        with self.Session() as db:
            admin_user = db.get(User, self.admin_id)
            req = self._mock_request()
            resp = admin_page(req, admin_user, db)
            self.assertEqual(resp.status_code, 200)

            # Add product
            resp_add = product_add(req, "New Milk", "2.50", admin_user, db)
            self.assertEqual(resp_add.status_code, 303)
            new_p = db.query(Product).filter(Product.name == "New Milk").first()
            self.assertIsNotNone(new_p)

            # Legacy extra_price form fields are ignored, while each existing monthly
            # price event remains in history when another price is saved.
            db.add(
                ProductPrice(
                    product_id=new_p.id,
                    period=current_period(),
                    price_cents=280,
                )
            )
            db.commit()
            form_dict = [("name", "New Milk"), ("price", "2.60"), ("extra_price", "2.80"), ("active", "on")]
            req_edit = self._mock_request(form_data=form_dict)
            resp_edit = asyncio.run(product_edit(req_edit, new_p.id, admin_user, db))
            self.assertEqual(resp_edit.status_code, 303)
            month_prices = db.query(ProductPrice).filter(
                ProductPrice.product_id == new_p.id,
                ProductPrice.period.like(f"{current_period()}%"),
            ).all()
            self.assertEqual(
                {row.period: row.price_cents for row in month_prices},
                {current_period(): 280, f"{current_period()}_1": 260},
            )

            # Delete and restore product
            resp_del = product_delete(req, new_p.id, admin_user, db)
            self.assertEqual(resp_del.status_code, 303)
            self.assertIsNone(db.query(Product).filter(Product.id == new_p.id).first())

    def test_admin_stores_endpoints(self):
        with self.Session() as db:
            admin_user = db.get(User, self.admin_id)
            req = self._mock_request()
            # Add store
            resp = store_add(req, "Second Store", "store2", "secret123", admin_user, db)
            self.assertEqual(resp.status_code, 303)
            s2 = db.query(Store).filter(Store.name == "Second Store").first()
            self.assertIsNotNone(s2)

            # Edit store
            resp_edit = store_edit(req, s2.id, "Second Store Updated", "store2_new", admin_user, db)
            self.assertEqual(resp_edit.status_code, 303)

            # Change password
            resp_pw = store_password(req, s2.id, "newsecret123", admin_user, db)
            self.assertEqual(resp_pw.status_code, 303)

            # Delete store
            resp_del = store_delete(req, s2.id, admin_user, db)
            self.assertEqual(resp_del.status_code, 303)

    def test_admin_reports_and_summary_endpoints(self):
        with self.Session() as db:
            admin_user = db.get(User, self.admin_id)
            req = self._mock_request()
            # Summary page & Excel
            resp_sum = summary_page(req, "2026-10", False, admin_user, db)
            self.assertEqual(resp_sum.status_code, 200)

            resp_xlsx = summary_xlsx("2026-10", False, admin_user, db)
            self.assertEqual(resp_xlsx.status_code, 200)

            # Reports list
            resp_reps = reports_page(req, "2026-10", admin_user, db)
            self.assertEqual(resp_reps.status_code, 200)

            # Logs page
            resp_logs = logs_page(req, None, None, admin_user, db)
            self.assertEqual(resp_logs.status_code, 200)

            # Admin password change
            resp_pw = admin_password(req, "brandnewpass123", admin_user, db)
            self.assertEqual(resp_pw.status_code, 303)

    def test_store_report_endpoints(self):
        with self.Session() as db:
            store_user = db.get(User, self.store_user_id)
            admin_user = db.get(User, self.admin_id)
            req = self._mock_request()
            # View report
            resp_rep = report_page(req, "2026-10", store_user, db)
            self.assertEqual(resp_rep.status_code, 200)

            # Save draft
            form_data = [("period", "2026-10"), (f"qty_{self.product_id}_150", "7"), ("action", "save")]
            req_save = self._mock_request(form_data=form_data)
            resp_save = asyncio.run(report_save(req_save, store_user, db))
            self.assertEqual(resp_save.status_code, 303)

            saved = db.query(Report).filter(Report.store_id == self.store_id, Report.period == "2026-10").first()
            self.assertIsNotNone(saved)
            self.assertEqual(saved.items[0].quantity, 7)

            # Toggle status in admin
            resp_status = report_status(req, saved.id, "submitted", admin_user, db)
            self.assertEqual(resp_status.status_code, 303)
            self.assertEqual(saved.status, "submitted")


if __name__ == "__main__":
    unittest.main()
