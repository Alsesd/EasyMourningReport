"""Tests for JSON auth endpoints, SPA fallback routing, and route precedence."""

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine

from app.core.dependencies import get_db
from app.core.security import hash_pw
from app.db.base import Base
from app.db.models.store import Store
from app.db.models.user import User
from app.main import app


class SpaAndAuthApiTests(unittest.TestCase):
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
            admin = User(login="superadmin", password_hash=hash_pw("adminsecret"), role="admin")
            store = Store(name="Фруктовий Магазин", archived=False)
            archived_store = Store(name="Закритий Магазин", archived=True)
            db.add_all([admin, store, archived_store])
            db.flush()

            store_user = User(
                login="fruitstore",
                password_hash=hash_pw("storesecret"),
                role="store",
                store_id=store.id,
            )
            archived_user = User(
                login="closedstore",
                password_hash=hash_pw("closedsecret"),
                role="store",
                store_id=archived_store.id,
            )
            db.add_all([store_user, archived_user])
            db.commit()

        self.client = TestClient(app, base_url="http://testserver")

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_json_login_success_admin(self):
        resp = self.client.post(
            "/api/v1/auth/login",
            json={"login": "superadmin", "password": "adminsecret"},
            headers={"Origin": "http://testserver"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["login"], "superadmin")
        self.assertEqual(data["role"], "admin")

        # Session cookie is present and verifies identity
        session_resp = self.client.get("/api/v1/session")
        self.assertEqual(session_resp.status_code, 200)
        self.assertEqual(session_resp.json()["login"], "superadmin")

    def test_json_login_success_store(self):
        resp = self.client.post(
            "/api/v1/auth/login",
            json={"login": "fruitstore", "password": "storesecret"},
            headers={"Origin": "http://testserver"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["login"], "fruitstore")
        self.assertEqual(data["role"], "store")
        self.assertEqual(data["store_name"], "Фруктовий Магазин")

    def test_json_login_invalid_password(self):
        resp = self.client.post(
            "/api/v1/auth/login",
            json={"login": "superadmin", "password": "wrongpassword"},
            headers={"Origin": "http://testserver"},
        )
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["detail"], "Неправильний логін або пароль")

    def test_json_login_unknown_user(self):
        resp = self.client.post(
            "/api/v1/auth/login",
            json={"login": "nonexistent", "password": "adminsecret"},
            headers={"Origin": "http://testserver"},
        )
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["detail"], "Неправильний логін або пароль")

    def test_json_login_archived_store(self):
        resp = self.client.post(
            "/api/v1/auth/login",
            json={"login": "closedstore", "password": "closedsecret"},
            headers={"Origin": "http://testserver"},
        )
        self.assertEqual(resp.status_code, 403)
        self.assertIn("обліковий запис вимкнено", resp.json()["detail"])

    def test_json_login_rate_limiting(self):
        with patch("app.routes.auth.retry_after", return_value=60):
            resp = self.client.post(
                "/api/v1/auth/login",
                json={"login": "superadmin", "password": "adminsecret"},
                headers={"Origin": "http://testserver"},
            )
            self.assertEqual(resp.status_code, 429)
            self.assertEqual(resp.headers.get("retry-after"), "60")
            self.assertIn("Забагато невдалих спроб", resp.json()["detail"])

    def test_json_logout(self):
        # First sign in
        self.client.post(
            "/api/v1/auth/login",
            json={"login": "superadmin", "password": "adminsecret"},
            headers={"Origin": "http://testserver"},
        )
        # Sign out
        resp = self.client.post(
            "/api/v1/auth/logout",
            headers={"Origin": "http://testserver"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("вийшли", resp.json()["message"])

        # Subsequent session check returns 401
        session_resp = self.client.get("/api/v1/session")
        self.assertEqual(session_resp.status_code, 401)

    def test_spa_fallback_serves_html(self):
        resp = self.client.get("/admin/custom-spa-page")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.headers["content-type"])
        self.assertIn("Легкий звіт".encode("utf-8"), resp.content)

    def test_api_routes_do_not_fallback_to_spa(self):
        resp = self.client.get("/api/v1/unmatched-endpoint")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("application/json", resp.headers["content-type"])

    def test_static_routes_precedence(self):
        resp = self.client.get("/manifest.webmanifest")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("manifest+json", resp.headers["content-type"])
