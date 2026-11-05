"""The administration overview only contains what the caller may see."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "api-test-session-secret")

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.modules.reports.models import Product
from app.platform.accounts.testing import make_admin, make_member, make_organisation

H = {"origin": "http://testserver"}


class OverviewApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        Session = sessionmaker(self.engine, expire_on_commit=False)

        def override_get_db():
            with Session() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        with Session() as db:
            make_admin(db, "boss", "boss-pass")
            shop = make_organisation(db, "Shop")
            make_member(db, shop, "manager", "manager-pass", role_key="org_admin")
            make_member(db, shop, "clerk", "clerk-pass", active=False)
            make_organisation(db, "Closed", archived=True)
            db.add(Product(name="Bread", price_cents=100))
            db.commit()
        self.clients = []

    def tearDown(self):
        for c in self.clients:
            c.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def login(self, login, password):
        client = TestClient(app)
        self.clients.append(client)
        self.assertEqual(client.post("/api/v1/auth/login", json={"login": login, "password": password}, headers=H).status_code, 200)
        return client

    def test_platform_admin_sees_everything(self):
        with patch("app.platform.overview.tunnel.status", return_value={
            "enabled": False, "autostart": False, "has_token": False, "state": "disabled", "public_url": "", "error": "",
        }):
            data = self.login("boss", "boss-pass").get("/api/v1/admin/overview").json()
        self.assertEqual(data["accounts"], {"organisations": 1, "archived_organisations": 1, "users": 3, "inactive_users": 1, "roles": 3})
        self.assertEqual(data["tunnel"]["state"], "disabled")
        self.assertTrue(data["health"]["database_ok"])
        self.assertEqual(data["recent_activity"][0]["action"], "вхід")
        reports = next(m for m in data["modules"] if m["module"] == "reports")
        self.assertEqual([s["label"] for s in reports["stats"]], ["Надіслано звітів за місяць", "Активних товарів"])
        self.assertEqual(reports["stats"][1]["value"], "1")

    def test_org_admin_sees_only_their_organisation(self):
        data = self.login("manager", "manager-pass").get("/api/v1/admin/overview").json()
        self.assertEqual(data["accounts"]["users"], 2)
        self.assertEqual(data["accounts"]["inactive_users"], 1)
        self.assertIsNone(data["tunnel"])
        self.assertIsNone(data["health"])
        self.assertIsNone(data["recent_activity"])
        self.assertEqual(data["modules"], [])


if __name__ == "__main__":
    unittest.main()
