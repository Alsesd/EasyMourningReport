"""Integration tests for the versioned REST API and its DTO boundary."""
import os
import unittest
from io import BytesIO

from openpyxl import Workbook

os.environ.setdefault("SECRET_KEY", "api-test-session-secret")

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine

from app.core.dependencies import get_db
from app.core.ui import current_period
from app.db.base import Base
from app.db.models.product import Product, ProductPrice
from app.db.models.report import Report, ReportItem
from app.db.models.store import Store
from app.db.models.user import User
from app.main import app
from app.core.security import hash_pw
from app.services.pricing import BASE_PERIOD


class RestApiTests(unittest.TestCase):
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
        self.period = current_period()
        with self.Session() as db:
            admin = User(login="apiadmin", password_hash=hash_pw("admin123"), role="admin")
            store = Store(name="API Test Store")
            db.add_all([admin, store])
            db.flush()
            store_user = User(
                login="apistore",
                password_hash=hash_pw("store123"),
                role="store",
                store_id=store.id,
            )
            product = Product(name="API Bread", price_cents=150, active=True, archived=False)
            db.add_all([store_user, product])
            db.flush()
            db.add(ProductPrice(product_id=product.id, period=BASE_PERIOD, price_cents=150))
            report = Report(store_id=store.id, period=self.period, status="draft")
            db.add(report)
            db.flush()
            db.add(ReportItem(report_id=report.id, product_id=product.id, quantity=1, unit_price_cents=150))
            db.commit()
            self.admin_id = admin.id
            self.store_id = store.id
            self.store_user_id = store_user.id
            self.product_id = product.id

        self.admin_client = TestClient(app)
        self.store_client = TestClient(app)
        admin_login = self.admin_client.post(
            "/login", data={"login": "apiadmin", "password": "admin123"},
            headers={"origin": "http://testserver"},
        )
        store_login = self.store_client.post(
            "/login", data={"login": "apistore", "password": "store123"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(admin_login.status_code, 303)
        self.assertEqual(store_login.status_code, 303)

    def tearDown(self):
        self.admin_client.close()
        self.store_client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_api_requires_session_and_returns_json_errors(self):
        anonymous = TestClient(app)
        response = anonymous.get("/api/v1/session")
        anonymous.close()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Увійдіть у систему.")

    def test_product_crud_uses_dtos_and_preserves_archive_semantics(self):
        response = self.admin_client.get("/api/v1/admin/products")
        self.assertEqual(response.status_code, 200)
        item = next(row for row in response.json() if row["id"] == self.product_id)
        self.assertEqual(item["price_cents"], 150)
        self.assertEqual(item["used_count"], 1)
        self.assertNotIn("password_hash", item)

        created = self.admin_client.post(
            "/api/v1/admin/products",
            json={"name": "Milk", "price": "2.50"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(created.status_code, 201)
        created_data = created.json()
        self.assertEqual(created_data["price_cents"], 250)
        self.assertEqual(created_data["name"], "Milk")

        updated = self.admin_client.put(
            f"/api/v1/admin/products/{created_data['id']}",
            json={"name": "Fresh Milk", "price": "2,80", "active": False},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["price_cents"], 280)
        self.assertFalse(updated.json()["active"])

        archived = self.admin_client.delete(
            f"/api/v1/admin/products/{self.product_id}",
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(archived.status_code, 200)
        self.assertTrue(archived.json()["archived"])
        restored = self.admin_client.post(
            f"/api/v1/admin/products/{self.product_id}/restore",
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(restored.status_code, 200)
        self.assertFalse(restored.json()["archived"])

    def test_store_report_round_trip_and_locking(self):
        response = self.store_client.get(f"/api/v1/store/reports/{self.period}")
        self.assertEqual(response.status_code, 200)
        report = response.json()
        self.assertEqual(report["rows"][0]["inputs"][0]["price_cents"], 150)

        saved = self.store_client.put(
            f"/api/v1/store/reports/{self.period}",
            json={
                "action": "draft",
                "quantities": [{"product_id": self.product_id, "price_cents": 150, "quantity": 7}],
            },
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["total_cents"], 1050)
        self.assertFalse(saved.json()["read_only"])

        submitted = self.store_client.put(
            f"/api/v1/store/reports/{self.period}",
            json={
                "action": "submit",
                "quantities": [{"product_id": self.product_id, "price_cents": 150, "quantity": 7}],
            },
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(submitted.status_code, 200)
        self.assertTrue(submitted.json()["read_only"])
        locked = self.store_client.put(
            f"/api/v1/store/reports/{self.period}",
            json={"action": "draft", "quantities": []},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(locked.status_code, 409)

    def test_admin_reports_summary_and_log_filters_return_dtos(self):
        with self.Session() as db:
            db.add(Store(name="Store without report"))
            db.commit()

        reports = self.admin_client.get(f"/api/v1/admin/reports?period={self.period}")
        self.assertEqual(reports.status_code, 200)
        by_name = {row["store_name"]: row for row in reports.json()}
        self.assertEqual(by_name["API Test Store"]["status"], "draft")
        self.assertEqual(by_name["Store without report"]["status"], "none")
        self.assertIsNone(by_name["Store without report"]["report_id"])

        summary = self.admin_client.get(f"/api/v1/admin/summary?period={self.period}")
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(summary.json()["period"], self.period)
        self.assertIn("grand_total_cents", summary.json())

        actions = self.admin_client.get("/api/v1/admin/log-actions")
        self.assertEqual(actions.status_code, 200)
        self.assertIn("вхід", actions.json())
        logs = self.admin_client.get("/api/v1/admin/logs?limit=10")
        self.assertEqual(logs.status_code, 200)
        self.assertTrue(all("password_hash" not in row for row in logs.json()))

    def test_excel_import_and_admin_password_return_json_dtos(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["Назва", "Ціна"])
        sheet.append(["Imported Flour", 14.25])
        stream = BytesIO()
        workbook.save(stream)
        stream.seek(0)

        imported = self.admin_client.post(
            "/api/v1/admin/products/import",
            files={"file": ("products.xlsx", stream.getvalue(),
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(imported.status_code, 200)
        self.assertIn("Імпорт завершено", imported.json()["message"])
        names = [item["name"] for item in self.admin_client.get("/api/v1/admin/products").json()]
        self.assertIn("Imported Flour", names)

        changed = self.admin_client.put(
            "/api/v1/admin/password",
            json={"password": "new-admin-password"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(changed.json()["message"], "Ваш пароль змінено.")

    def test_mutating_api_rejects_requests_without_same_origin_header(self):
        response = self.admin_client.post(
            "/api/v1/admin/products", json={"name": "Missing Origin", "price": "1.00"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Відхилено запит без перевірки джерела.")


if __name__ == "__main__":
    unittest.main()
