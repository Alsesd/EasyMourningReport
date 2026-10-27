"""Integration tests for user administration, departments, and permissions."""

import os
import unittest

os.environ.setdefault("SECRET_KEY", "users-api-test-secret")

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine

from app.core.database import Base, get_db
from app.core.security import hash_pw
from app.features.auth.models import User
from app.features.stores.models import Store
from app.main import app


class UsersApiTests(unittest.TestCase):
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
            admin = User(
                login="admin",
                name="Адміністратор",
                password_hash=hash_pw("admin-pass"),
                role="admin",
            )
            store = Store(name="Центральний відділ")
            db.add_all([admin, store])
            db.flush()
            db.add(
                User(
                    login="legacy",
                    password_hash=hash_pw("legacy-pass"),
                    role="store",
                    store_id=store.id,
                )
            )
            db.commit()
            self.admin_id = admin.id
            self.store_id = store.id

        self.admin = TestClient(app, follow_redirects=False)
        self.store = TestClient(app, follow_redirects=False)
        self.assertEqual(
            self.admin.post(
                "/api/v1/auth/login",
                json={"login": "admin", "password": "admin-pass"},
                headers={"Origin": "http://testserver"},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.store.post(
                "/api/v1/auth/login",
                json={"login": "legacy", "password": "legacy-pass"},
                headers={"Origin": "http://testserver"},
            ).status_code,
            200,
        )

    def tearDown(self):
        self.admin.close()
        self.store.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_list_users_exposes_permissions_and_department(self):
        response = self.admin.get("/api/v1/admin/users")
        self.assertEqual(response.status_code, 200)
        rows = {row["login"]: row for row in response.json()}
        self.assertEqual(
            rows["admin"]["permissions"],
            ["transport_order", "sales_report", "vehicle_dispatch", "driver"],
        )
        self.assertEqual(rows["legacy"]["permissions"], ["sales_report"])
        self.assertEqual(rows["legacy"]["department_id"], self.store_id)
        self.assertEqual(rows["legacy"]["department_name"], "Центральний відділ")
        self.assertNotIn("password_hash", rows["legacy"])

        stores = self.admin.get("/api/v1/admin/stores").json()
        central = next(row for row in stores if row["id"] == self.store_id)
        self.assertEqual(central["users"][0]["login"], "legacy")

    def test_create_department_and_user_can_log_in_with_permissions(self):
        department = self.admin.post(
            "/api/v1/admin/stores",
            json={"name": "Відділ логістики"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(department.status_code, 201)
        self.assertEqual(department.json()["users"], [])
        department_id = department.json()["id"]

        created = self.admin.post(
            "/api/v1/admin/users",
            json={
                "name": "Олена Петренко",
                "login": "OLENA",
                "password": "secret-123",
                "department_id": department_id,
                "permissions": ["driver", "transport_order"],
            },
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(created.status_code, 201)
        user = created.json()
        self.assertEqual(user["login"], "olena")
        self.assertEqual(user["name"], "Олена Петренко")
        self.assertEqual(user["department_name"], "Відділ логістики")
        self.assertEqual(user["permissions"], ["transport_order", "driver"])

        login = TestClient(app, follow_redirects=False)
        session = login.post(
            "/api/v1/auth/login",
            json={"login": "olena", "password": "secret-123"},
            headers={"Origin": "http://testserver"},
        )
        self.assertEqual(session.status_code, 200)
        self.assertEqual(session.json()["name"], "Олена Петренко")
        self.assertEqual(session.json()["department_name"], "Відділ логістики")
        self.assertEqual(session.json()["permissions"], ["transport_order", "driver"])
        self.assertEqual(
            login.get(f"/api/v1/store/reports/{session.json()['period']}").status_code,
            403,
        )
        login.close()

    def test_user_crud_and_validation(self):
        created = self.admin.post(
            "/api/v1/admin/users",
            json={
                "name": "Іван",
                "login": "ivan",
                "password": "secret-123",
                "department_name": "Новий відділ",
                "permissions": ["vehicle_dispatch"],
            },
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(created.status_code, 201)
        user_id = created.json()["id"]

        updated = self.admin.put(
            f"/api/v1/admin/users/{user_id}",
            json={
                "name": "Іван Франко",
                "login": "ivan.f",
                "password": "new-secret-123",
                "department_name": "Диспетчерська",
                "permissions": ["vehicle_dispatch", "driver"],
            },
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["login"], "ivan.f")
        self.assertEqual(updated.json()["department_name"], "Диспетчерська")
        self.assertEqual(updated.json()["permissions"], ["vehicle_dispatch", "driver"])

        login = TestClient(app, follow_redirects=False)
        self.assertEqual(
            login.post(
                "/api/v1/auth/login",
                json={"login": "ivan.f", "password": "new-secret-123"},
                headers={"Origin": "http://testserver"},
            ).status_code,
            200,
        )
        login.close()

        bad_permission = self.admin.put(
            f"/api/v1/admin/users/{user_id}",
            json={
                "name": "Іван Франко",
                "login": "ivan.f",
                "department_id": self.store_id,
                "permissions": ["unknown"],
            },
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(bad_permission.status_code, 422)
        self.assertIn("Невідомі права", bad_permission.json()["detail"])

        duplicate = self.admin.post(
            "/api/v1/admin/users",
            json={
                "name": "Дубль",
                "login": "legacy",
                "password": "secret-123",
                "department_id": self.store_id,
                "permissions": ["sales_report"],
            },
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(duplicate.status_code, 422)
        self.assertIn("зайнятий", duplicate.json()["detail"])

        both_departments = self.admin.post(
            "/api/v1/admin/users",
            json={
                "name": "Конфлікт",
                "login": "conflict",
                "password": "secret-123",
                "department_id": self.store_id,
                "department_name": "Інший",
                "permissions": ["sales_report"],
            },
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(both_departments.status_code, 422)

        deleted = self.admin.delete(
            f"/api/v1/admin/users/{user_id}", headers={"origin": "http://testserver"}
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["deleted"])
        self.assertEqual(
            self.admin.put(
                f"/api/v1/admin/users/{user_id}",
                json={
                    "name": "Зник",
                    "login": "gone",
                    "department_id": self.store_id,
                    "permissions": ["sales_report"],
                },
                headers={"origin": "http://testserver"},
            ).status_code,
            404,
        )

    def test_admin_cannot_be_deleted_and_store_cannot_manage_users(self):
        forbidden = self.store.get("/api/v1/admin/users")
        self.assertEqual(forbidden.status_code, 403)

        protected = self.admin.delete(
            f"/api/v1/admin/users/{self.admin_id}",
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(protected.status_code, 422)
        self.assertIn("адміністратора", protected.json()["detail"])


if __name__ == "__main__":
    unittest.main()
