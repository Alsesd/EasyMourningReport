"""Integration tests for the versioned REST API and its DTO boundary."""
import os
import unittest
from io import BytesIO
from unittest.mock import patch

from openpyxl import Workbook

os.environ.setdefault("SECRET_KEY", "api-test-session-secret")

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine, select

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
            self.report_id = report.id

        self.admin_client = TestClient(app, follow_redirects=False)
        self.store_client = TestClient(app, follow_redirects=False)
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
        self.assertEqual(updated.json()["month_prices_cents"], [250, 280])

        # Each subsequent edit during the same month becomes a separate history event.
        updated_again = self.admin_client.put(
            f"/api/v1/admin/products/{created_data['id']}",
            json={"name": "Fresh Milk", "price": "3.10", "active": False},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(updated_again.status_code, 200)
        self.assertEqual(updated_again.json()["price_cents"], 310)
        self.assertEqual(updated_again.json()["month_prices_cents"], [250, 280, 310])
        self.assertEqual(
            [point["period"] for point in updated_again.json()["price_history"]],
            [BASE_PERIOD, self.period, f"{self.period}_1"],
        )

        # Returning to an earlier amount is recorded too. The UI timeline preserves
        # the repeated amount, but report input options remain de-duplicated by price.
        changed_back = self.admin_client.put(
            f"/api/v1/admin/products/{created_data['id']}",
            json={"name": "Fresh Milk", "price": "2.80", "active": False},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(changed_back.status_code, 200)
        self.assertEqual(changed_back.json()["price_cents"], 280)
        self.assertEqual(changed_back.json()["month_prices_cents"], [250, 280, 310, 280])
        with self.Session() as db:
            history = [
                (row.period, row.price_cents)
                for row in db.scalars(
                    select(ProductPrice).where(ProductPrice.product_id == created_data["id"]).order_by(ProductPrice.id)
                )
            ]
        self.assertEqual(
            history,
            [
                (BASE_PERIOD, 250),
                (self.period, 280),
                (f"{self.period}_1", 310),
                (f"{self.period}_2", 280),
            ],
        )

        # Once active, the store report offers each distinct price seen this month
        # even though the complete timeline records the return to 2.80 as a fourth event.
        reactivated = self.admin_client.put(
            f"/api/v1/admin/products/{created_data['id']}",
            json={"name": "Fresh Milk", "price": "2.80", "active": True},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(reactivated.status_code, 200)
        report_response = self.store_client.get(f"/api/v1/store/reports/{self.period}")
        self.assertEqual(report_response.status_code, 200)
        milk_row = next(row for row in report_response.json()["rows"] if row["id"] == created_data["id"])
        self.assertEqual([line["price_cents"] for line in milk_row["inputs"]], [250, 280, 310])

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

    def test_dedicated_price_endpoint_preserves_month_history_and_saved_report_rows(self):
        url = f"/api/v1/admin/products/{self.product_id}/price"
        headers = {"origin": "http://testserver"}

        first = self.admin_client.put(url, json={"price": "1.80"}, headers=headers)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["price_cents"], 180)
        self.assertEqual(first.json()["month_prices_cents"], [150, 180])

        second = self.admin_client.put(url, json={"price": "2.10"}, headers=headers)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["month_prices_cents"], [150, 180, 210])

        returned = self.admin_client.put(url, json={"price": "1.80"}, headers=headers)
        self.assertEqual(returned.status_code, 200)
        self.assertEqual(returned.json()["name"], "API Bread")
        self.assertTrue(returned.json()["active"])
        self.assertEqual(returned.json()["price_cents"], 180)
        self.assertEqual(returned.json()["month_prices_cents"], [150, 180, 210, 180])

        # A no-op must not append another history event.
        unchanged = self.admin_client.put(url, json={"price": "1.80"}, headers=headers)
        self.assertEqual(unchanged.status_code, 200)
        self.assertEqual(unchanged.json()["month_prices_cents"], [150, 180, 210, 180])

        with self.Session() as db:
            history = [
                (row.period, row.price_cents)
                for row in db.scalars(
                    select(ProductPrice)
                    .where(ProductPrice.product_id == self.product_id)
                    .order_by(ProductPrice.id)
                )
            ]
            saved_item = db.scalar(
                select(ReportItem).where(ReportItem.report_id == self.report_id)
            )
        self.assertEqual(
            history,
            [
                (BASE_PERIOD, 150),
                (self.period, 180),
                (f"{self.period}_1", 210),
                (f"{self.period}_2", 180),
            ],
        )
        self.assertEqual(saved_item.unit_price_cents, 150)

    def test_tailscale_funnel_controls_are_admin_only_and_do_not_return_secrets(self):
        status = {
            "enabled": False,
            "state": "disabled",
            "public_url": "",
            "login_url": "",
            "error": "",
        }
        with patch("app.routes.api_v1.tailscale_status", return_value=status):
            response = self.admin_client.get("/api/v1/admin/tailscale")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "disabled")

        refused = self.admin_client.post(
            "/api/v1/admin/tailscale",
            json={"confirm_public": False},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(refused.status_code, 400)

        running = {**status, "enabled": True, "state": "authentication-required",
                   "login_url": "https://login.tailscale.com/example"}
        with patch("app.routes.api_v1.start_funnel", return_value=running) as start:
            response = self.admin_client.post(
                "/api/v1/admin/tailscale",
                json={"confirm_public": True, "auth_key": "tskey-test-secret"},
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "authentication-required")
        start.assert_called_once_with("tskey-test-secret")
        self.assertNotIn("auth_key", response.json())

        with patch("app.routes.api_v1.stop_funnel", return_value=status):
            response = self.admin_client.delete(
                "/api/v1/admin/tailscale",
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["enabled"])

        forbidden = self.store_client.get("/api/v1/admin/tailscale")
        self.assertEqual(forbidden.status_code, 403)

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
            archived_store = Store(name="Archived without report", archived=True)
            db.add(archived_store)
            db.commit()
            archived_store_id = archived_store.id

        reports = self.admin_client.get(f"/api/v1/admin/reports?period={self.period}")
        self.assertEqual(reports.status_code, 200)
        by_name = {row["store_name"]: row for row in reports.json()}
        self.assertEqual(by_name["API Test Store"]["status"], "draft")
        self.assertEqual(by_name["Store without report"]["status"], "none")
        self.assertIsNone(by_name["Store without report"]["report_id"])
        self.assertNotIn("Archived without report", by_name)

        with self.Session() as db:
            archived_report = Report(store_id=archived_store_id, period=self.period, status="draft")
            db.add(archived_report)
            db.commit()
            archived_report_id = archived_report.id

        reports_with_archived = self.admin_client.get(f"/api/v1/admin/reports?period={self.period}")
        self.assertEqual(reports_with_archived.status_code, 200)
        by_name = {row["store_name"]: row for row in reports_with_archived.json()}
        self.assertEqual(by_name["Archived without report"]["status"], "draft")
        self.assertTrue(by_name["Archived without report"]["store_archived"])

        detail = self.admin_client.get(f"/api/v1/admin/reports/{self.report_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["report_id"], self.report_id)
        self.assertEqual(detail.json()["period"], self.period)
        self.assertEqual(
            self.admin_client.get("/api/v1/admin/reports/987654").status_code,
            404,
        )

        submitted = self.admin_client.patch(
            f"/api/v1/admin/reports/{self.report_id}",
            json={"status": "submitted"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json()["status"], "submitted")

        summary = self.admin_client.get(
            f"/api/v1/admin/summary?period={self.period}&submitted_only=true"
        )
        self.assertEqual(summary.status_code, 200)
        self.assertTrue(summary.json()["submitted_only"])
        self.assertIn("grand_total_cents", summary.json())

        reopened = self.admin_client.patch(
            f"/api/v1/admin/reports/{self.report_id}",
            json={"status": "draft"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(reopened.status_code, 200)
        self.assertEqual(reopened.json()["status"], "draft")
        self.assertEqual(
            self.admin_client.patch(
                "/api/v1/admin/reports/987654",
                json={"status": "submitted"},
                headers={"origin": "http://testserver"},
            ).status_code,
            404,
        )

        # Also cover the ordinary, unfiltered summary response.
        ordinary_summary = self.admin_client.get(f"/api/v1/admin/summary?period={self.period}")
        self.assertEqual(ordinary_summary.status_code, 200)
        self.assertFalse(ordinary_summary.json()["submitted_only"])

        actions = self.admin_client.get("/api/v1/admin/log-actions")
        self.assertEqual(actions.status_code, 200)
        self.assertIn("вхід", actions.json())
        logs = self.admin_client.get(
            "/api/v1/admin/logs?login=APIADMIN&action=вхід&limit=10"
        )
        self.assertEqual(logs.status_code, 200)
        self.assertTrue(logs.json())
        self.assertTrue(all(row["login"] == "apiadmin" for row in logs.json()))
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

    def test_session_roles_archived_store_and_missing_product_paths(self):
        session = self.admin_client.get("/api/v1/session")
        self.assertEqual(session.status_code, 200)
        self.assertEqual(session.json()["login"], "apiadmin")
        self.assertEqual(session.json()["role"], "admin")

        admin_as_store = self.admin_client.get(f"/api/v1/store/reports/{self.period}")
        self.assertEqual(admin_as_store.status_code, 403)
        store_as_admin = self.store_client.get("/api/v1/admin/products")
        self.assertEqual(store_as_admin.status_code, 403)

        with self.Session() as db:
            store = db.get(Store, self.store_id)
            store.archived = True
            db.commit()
        archived_session = self.store_client.get("/api/v1/session")
        self.assertEqual(archived_session.status_code, 401)
        self.assertEqual(archived_session.json()["detail"], "Увійдіть у систему.")

        headers = {"origin": "http://testserver"}
        missing_update = self.admin_client.put(
            "/api/v1/admin/products/987654",
            json={"name": "Missing", "price": "1.00", "active": True},
            headers=headers,
        )
        self.assertEqual(missing_update.status_code, 404)
        self.assertEqual(
            self.admin_client.delete("/api/v1/admin/products/987654", headers=headers).status_code,
            404,
        )
        self.assertEqual(
            self.admin_client.post("/api/v1/admin/products/987654/restore", headers=headers).status_code,
            404,
        )

    def test_admin_store_management_crud_passwords_and_archive_paths(self):
        headers = {"origin": "http://testserver"}
        listed = self.admin_client.get("/api/v1/admin/stores")
        self.assertEqual(listed.status_code, 200)
        self.assertIn("API Test Store", [row["name"] for row in listed.json()])

        created = self.admin_client.post(
            "/api/v1/admin/stores",
            json={"name": "Branch North", "login": "branchnorth", "password": "branch-pass"},
            headers=headers,
        )
        self.assertEqual(created.status_code, 201)
        sid = created.json()["id"]
        self.assertEqual(created.json()["reports_count"], 0)

        changed = self.admin_client.put(
            f"/api/v1/admin/stores/{sid}",
            json={"name": "Branch North Updated", "login": "branchnorth2"},
            headers=headers,
        )
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(changed.json()["name"], "Branch North Updated")
        # A no-op update still succeeds but does not need to create an audit change entry.
        no_op = self.admin_client.put(
            f"/api/v1/admin/stores/{sid}",
            json={"name": "Branch North Updated", "login": "branchnorth2"},
            headers=headers,
        )
        self.assertEqual(no_op.status_code, 200)

        with patch("app.routes.api_v1.check_unique_store"):
            conflict_update = self.admin_client.put(
                f"/api/v1/admin/stores/{sid}",
                json={"name": "API Test Store", "login": "branchnorth2"},
                headers=headers,
            )
        self.assertEqual(conflict_update.status_code, 409)

        with patch("app.routes.api_v1.check_unique_store"):
            conflict_create = self.admin_client.post(
                "/api/v1/admin/stores",
                json={"name": "API Test Store", "login": "anotherbranch", "password": "branch-pass"},
                headers=headers,
            )
        self.assertEqual(conflict_create.status_code, 409)

        changed_password = self.admin_client.put(
            f"/api/v1/admin/stores/{sid}/password",
            json={"password": "new-branch-pass"},
            headers=headers,
        )
        self.assertEqual(changed_password.status_code, 200)
        self.assertIn("змінено", changed_password.json()["message"])

        with patch("app.routes.api_v1.backup_db") as backup:
            deleted = self.admin_client.delete(f"/api/v1/admin/stores/{sid}", headers=headers)
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["deleted"])
        backup.assert_called_once()
        self.assertEqual(
            self.admin_client.put(
                f"/api/v1/admin/stores/{sid}",
                json={"name": "Gone", "login": "gone"},
                headers=headers,
            ).status_code,
            404,
        )
        self.assertEqual(self.admin_client.delete(f"/api/v1/admin/stores/{sid}", headers=headers).status_code, 404)
        self.assertEqual(
            self.admin_client.post(f"/api/v1/admin/stores/{sid}/restore", headers=headers).status_code,
            404,
        )
        self.assertEqual(
            self.admin_client.put(
                f"/api/v1/admin/stores/{sid}/password",
                json={"password": "new-branch-pass"},
                headers=headers,
            ).status_code,
            404,
        )

        # This store has a report, so deletion must archive it rather than remove it.
        archived = self.admin_client.delete(f"/api/v1/admin/stores/{self.store_id}", headers=headers)
        self.assertEqual(archived.status_code, 200)
        self.assertTrue(archived.json()["archived"])
        restored = self.admin_client.post(
            f"/api/v1/admin/stores/{self.store_id}/restore",
            headers=headers,
        )
        self.assertEqual(restored.status_code, 200)
        self.assertFalse(restored.json()["archived"])
        self.assertEqual(
            self.admin_client.delete("/api/v1/admin/stores/987654", headers=headers).status_code,
            404,
        )

    def test_unused_product_delete_and_invalid_excel_uploads(self):
        headers = {"origin": "http://testserver"}
        created = self.admin_client.post(
            "/api/v1/admin/products",
            json={"name": "Disposable Product", "price": "1.00"},
            headers=headers,
        )
        self.assertEqual(created.status_code, 201)
        pid = created.json()["id"]

        with patch("app.routes.api_v1.backup_db") as backup:
            deleted = self.admin_client.delete(f"/api/v1/admin/products/{pid}", headers=headers)
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["deleted"])
        backup.assert_called_once()

        wrong_type = self.admin_client.post(
            "/api/v1/admin/products/import",
            files={"file": ("products.csv", b"not an Excel workbook", "text/csv")},
            headers=headers,
        )
        self.assertEqual(wrong_type.status_code, 400)

        empty = self.admin_client.post(
            "/api/v1/admin/products/import",
            files={"file": ("empty.xlsx", b"", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=headers,
        )
        self.assertEqual(empty.status_code, 400)

        oversized = self.admin_client.post(
            "/api/v1/admin/products/import",
            files={"file": ("large.xlsx", b"x" * (10 * 1024 * 1024 + 1), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=headers,
        )
        self.assertEqual(oversized.status_code, 400)

    def test_store_report_validation_preservation_and_missing_report_creation(self):
        headers = {"origin": "http://testserver"}
        self.assertEqual(
            self.store_client.get("/api/v1/store/reports/2000-01").status_code,
            404,
        )
        self.assertEqual(
            self.store_client.put(
                "/api/v1/store/reports/2000-01",
                json={"action": "draft", "quantities": []},
                headers=headers,
            ).status_code,
            403,
        )

        duplicate = self.store_client.put(
            f"/api/v1/store/reports/{self.period}",
            json={
                "action": "draft",
                "quantities": [
                    {"product_id": self.product_id, "price_cents": 150, "quantity": 1},
                    {"product_id": self.product_id, "price_cents": 150, "quantity": 2},
                ],
            },
            headers=headers,
        )
        self.assertEqual(duplicate.status_code, 422)

        stale_price = self.store_client.put(
            f"/api/v1/store/reports/{self.period}",
            json={
                "action": "draft",
                "quantities": [{"product_id": self.product_id, "price_cents": 999, "quantity": 1}],
            },
            headers=headers,
        )
        self.assertEqual(stale_price.status_code, 409)

        archived = self.admin_client.delete(
            f"/api/v1/admin/products/{self.product_id}",
            headers=headers,
        )
        self.assertTrue(archived.json()["archived"])
        preserved = self.store_client.put(
            f"/api/v1/store/reports/{self.period}",
            json={"action": "draft", "quantities": []},
            headers=headers,
        )
        self.assertEqual(preserved.status_code, 200)
        self.assertEqual(preserved.json()["total_cents"], 150)
        self.assertEqual(len(preserved.json()["inactive_rows"]), 1)

        self.admin_client.post(
            f"/api/v1/admin/products/{self.product_id}/restore",
            headers=headers,
        )
        zero_quantity = self.store_client.put(
            f"/api/v1/store/reports/{self.period}",
            json={
                "action": "draft",
                "quantities": [{"product_id": self.product_id, "price_cents": 150, "quantity": 0}],
            },
            headers=headers,
        )
        self.assertEqual(zero_quantity.status_code, 200)
        self.assertEqual(zero_quantity.json()["total_cents"], 0)

        # The current month can be opened again if its report row was removed.
        with self.Session() as db:
            for item in db.query(ReportItem).filter(ReportItem.report_id == self.report_id).all():
                db.delete(item)
            report = db.get(Report, self.report_id)
            db.delete(report)
            db.commit()
        reopened = self.store_client.put(
            f"/api/v1/store/reports/{self.period}",
            json={
                "action": "draft",
                "quantities": [{"product_id": self.product_id, "price_cents": 150, "quantity": 3}],
            },
            headers=headers,
        )
        self.assertEqual(reopened.status_code, 200)
        self.assertEqual(reopened.json()["status"], "draft")
        self.assertEqual(reopened.json()["total_cents"], 450)

    def test_mutating_api_rejects_requests_without_same_origin_header(self):
        response = self.admin_client.post(
            "/api/v1/admin/products", json={"name": "Missing Origin", "price": "1.00"}
        )
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
