"""Organisations, users, roles and permission enforcement through the REST API."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "api-test-session-secret")

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine, select

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.modules.reports.models import Report
from app.platform.accounts.models import Role
from app.platform.accounts.testing import make_admin, make_member, make_organisation

H = {"origin": "http://testserver"}


class AccountsApiTests(unittest.TestCase):
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
            self.admin_id = make_admin(db, "boss", "boss-pass").id
            shop = make_organisation(db, "Shop A")
            other = make_organisation(db, "Shop B")
            self.shop_id, self.other_id = shop.id, other.id
            self.manager_id = make_member(db, shop, "manager", "manager-pass", role_key="org_admin").id
            self.clerk_id = make_member(db, shop, "clerk", "clerk-pass").id
            self.foreign_id = make_member(db, other, "foreign", "foreign-pass").id
            db.add(Report(store_id=shop.id, period="2026-10"))
            db.commit()
            roles = {r.key: r.id for r in db.scalars(select(Role))}
        self.roles = roles
        self.clients: list[TestClient] = []

    def tearDown(self):
        for client in self.clients:
            client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def login(self, login: str, password: str) -> TestClient:
        client = TestClient(app, follow_redirects=False)
        self.clients.append(client)
        response = client.post("/api/v1/auth/login", json={"login": login, "password": password}, headers=H)
        self.assertEqual(response.status_code, 200, response.text)
        return client

    # --- organisations ---------------------------------------------------------

    def test_organisation_lifecycle_with_first_user_archive_and_delete(self):
        admin = self.login("boss", "boss-pass")
        created = admin.post(
            "/api/v1/organisations",
            json={"name": "Branch North", "first_user": {"login": "North", "password": "north-pass"}},
            headers=H,
        )
        self.assertEqual(created.status_code, 201, created.text)
        oid = created.json()["id"]
        self.assertEqual(created.json()["user_count"], 1)
        # The first user signs in with the built-in store role.
        north = self.login("north", "north-pass")
        self.assertEqual(north.get("/api/v1/session").json()["permissions"], ["reports.submit"])

        duplicate = admin.post("/api/v1/organisations", json={"name": " branch  north "}, headers=H)
        self.assertEqual(duplicate.status_code, 422)

        renamed = admin.put(f"/api/v1/organisations/{oid}", json={"name": "Branch N"}, headers=H)
        self.assertEqual(renamed.json()["name"], "Branch N")

        with patch("app.platform.accounts.routes.backup_db") as backup:
            deleted = admin.delete(f"/api/v1/organisations/{oid}", headers=H)
        self.assertTrue(deleted.json()["deleted"])
        backup.assert_called_once()
        self.assertNotIn("north", [u["login"] for u in admin.get("/api/v1/users").json()])

        # An organisation with reports is archived; its users can no longer sign in.
        listed = {o["id"]: o for o in admin.get("/api/v1/organisations").json()}
        self.assertEqual(listed[self.shop_id]["usage"], {"reports": 1})
        archived = admin.delete(f"/api/v1/organisations/{self.shop_id}", headers=H)
        self.assertTrue(archived.json()["archived"])
        refused = TestClient(app).post(
            "/api/v1/auth/login", json={"login": "clerk", "password": "clerk-pass"}, headers=H
        )
        self.assertEqual(refused.status_code, 403)
        restored = admin.post(f"/api/v1/organisations/{self.shop_id}/restore", headers=H)
        self.assertFalse(restored.json()["archived"])

    def test_store_users_cannot_manage_accounts(self):
        clerk = self.login("clerk", "clerk-pass")
        for method, path in (
            ("get", "/api/v1/organisations"),
            ("get", "/api/v1/users"),
            ("get", "/api/v1/roles"),
            ("get", "/api/v1/permissions"),
            ("get", "/api/v1/admin/products"),
            ("get", "/api/v1/admin/logs"),
        ):
            self.assertEqual(getattr(clerk, method)(path).status_code, 403, path)

    # --- users -----------------------------------------------------------------

    def test_platform_admin_creates_multiple_users_per_organisation(self):
        admin = self.login("boss", "boss-pass")
        created = admin.post(
            "/api/v1/users",
            json={
                "login": "Second",
                "password": "second-pass",
                "full_name": "  Олена   Петрівна ",
                "organisation_id": self.shop_id,
                "role_ids": [self.roles["store"]],
            },
            headers=H,
        )
        self.assertEqual(created.status_code, 201, created.text)
        body = created.json()
        self.assertEqual(body["login"], "second")
        self.assertEqual(body["full_name"], "Олена Петрівна")
        self.assertEqual(body["organisation"]["name"], "Shop A")
        shop_users = admin.get(f"/api/v1/users?organisation_id={self.shop_id}").json()
        self.assertEqual({u["login"] for u in shop_users}, {"manager", "clerk", "second"})

        # A platform role cannot be given to an organisation member.
        wrong_scope = admin.post(
            "/api/v1/users",
            json={"login": "x1", "password": "secret1", "organisation_id": self.shop_id,
                  "role_ids": [self.roles["platform_admin"]]},
            headers=H,
        )
        self.assertEqual(wrong_scope.status_code, 422)

        reset = admin.put(f"/api/v1/users/{body['id']}/password", json={"password": "changed-pass"}, headers=H)
        self.assertEqual(reset.status_code, 200)
        self.login("second", "changed-pass")

        disabled = admin.put(
            f"/api/v1/users/{body['id']}",
            json={"login": "second", "organisation_id": self.shop_id,
                  "role_ids": [self.roles["store"]], "active": False},
            headers=H,
        )
        self.assertFalse(disabled.json()["active"])
        refused = TestClient(app).post(
            "/api/v1/auth/login", json={"login": "second", "password": "changed-pass"}, headers=H
        )
        self.assertEqual(refused.status_code, 403)

    def test_last_admin_cannot_be_disabled_demoted_or_deleted(self):
        admin = self.login("boss", "boss-pass")
        self_disable = admin.put(
            f"/api/v1/users/{self.admin_id}",
            json={"login": "boss", "role_ids": [self.roles["platform_admin"]], "active": False},
            headers=H,
        )
        self.assertEqual(self_disable.status_code, 422)
        demote = admin.put(
            f"/api/v1/users/{self.admin_id}",
            json={"login": "boss", "role_ids": [], "active": True},
            headers=H,
        )
        self.assertEqual(demote.status_code, 422)
        self.assertIn("адміністратор", demote.json()["detail"])
        self.assertEqual(admin.delete(f"/api/v1/users/{self.admin_id}", headers=H).status_code, 422)

    def test_org_admin_manages_only_own_organisation_without_escalation(self):
        manager = self.login("manager", "manager-pass")
        listed = manager.get("/api/v1/users").json()
        self.assertEqual({u["login"] for u in listed}, {"manager", "clerk"})
        # Even when asking for another organisation, the manager only sees their own.
        self.assertEqual(
            {u["login"] for u in manager.get(f"/api/v1/users?organisation_id={self.other_id}").json()},
            {"manager", "clerk"},
        )

        created = manager.post(
            "/api/v1/users",
            json={"login": "helper", "password": "helper-pass", "organisation_id": self.other_id,
                  "role_ids": [self.roles["store"]]},
            headers=H,
        )
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()["organisation"]["id"], self.shop_id)

        foreign_edit = manager.put(
            f"/api/v1/users/{self.foreign_id}",
            json={"login": "foreign", "role_ids": [], "active": False},
            headers=H,
        )
        self.assertEqual(foreign_edit.status_code, 404)
        foreign_password = manager.put(
            f"/api/v1/users/{self.foreign_id}/password", json={"password": "hijack-pass"}, headers=H
        )
        self.assertEqual(foreign_password.status_code, 404)

        # Platform roles are never offered, and neither are roles with permissions the manager lacks.
        offered = {r["key"] for r in manager.get("/api/v1/roles").json()}
        self.assertIn("store", offered)
        self.assertIn("org_admin", offered)
        self.assertNotIn("platform_admin", offered)
        escalate = manager.post(
            "/api/v1/users",
            json={"login": "sneaky", "password": "sneaky-pass", "role_ids": [self.roles["platform_admin"]]},
            headers=H,
        )
        self.assertEqual(escalate.status_code, 422)
        self.assertEqual(
            manager.post("/api/v1/roles", json={"name": "Mine", "scope": "organisation", "permissions": []}, headers=H).status_code,
            403,
        )
        self.assertEqual(manager.get("/api/v1/organisations").status_code, 403)

    # --- roles -----------------------------------------------------------------

    def test_custom_role_grants_exactly_its_permissions(self):
        admin = self.login("boss", "boss-pass")
        catalogue = {p["code"]: p for p in admin.get("/api/v1/permissions").json()}
        self.assertEqual(catalogue["reports.review"]["module"], "reports")
        self.assertEqual(catalogue["transport.orders.create"]["scope"], "organisation")

        bad = admin.post(
            "/api/v1/roles",
            json={"name": "Mixed", "scope": "organisation", "permissions": ["reports.review"]},
            headers=H,
        )
        self.assertEqual(bad.status_code, 422)

        reviewer = admin.post(
            "/api/v1/roles",
            json={"name": "Бухгалтер", "scope": "platform", "permissions": ["reports.review", "platform.audit.view"]},
            headers=H,
        )
        self.assertEqual(reviewer.status_code, 201, reviewer.text)
        rid = reviewer.json()["id"]
        user = admin.post(
            "/api/v1/users",
            json={"login": "accountant", "password": "acc-pass", "role_ids": [rid]},
            headers=H,
        )
        self.assertEqual(user.status_code, 201, user.text)

        accountant = self.login("accountant", "acc-pass")
        self.assertEqual(
            accountant.get("/api/v1/session").json()["permissions"],
            ["platform.audit.view", "reports.review"],
        )
        self.assertEqual(accountant.get("/api/v1/admin/summary").status_code, 200)
        self.assertEqual(accountant.get("/api/v1/admin/logs").status_code, 200)
        self.assertEqual(accountant.get("/api/v1/admin/products").status_code, 403)
        self.assertEqual(accountant.get("/api/v1/admin/tunnel").status_code, 403)

        narrowed = admin.put(
            f"/api/v1/roles/{rid}",
            json={"name": "Бухгалтер", "scope": "platform", "permissions": ["reports.review"]},
            headers=H,
        )
        self.assertEqual(narrowed.json()["permissions"], ["reports.review"])
        self.assertEqual(accountant.get("/api/v1/admin/logs").status_code, 403)

        self.assertEqual(admin.delete(f"/api/v1/roles/{self.roles['store']}", headers=H).status_code, 422)
        self.assertTrue(admin.delete(f"/api/v1/roles/{rid}", headers=H).json()["deleted"])
        self.assertEqual(accountant.get("/api/v1/session").json()["permissions"], [])

    def test_built_in_admin_roles_always_hold_all_permissions(self):
        admin = self.login("boss", "boss-pass")
        roles = {r["key"]: r for r in admin.get("/api/v1/roles").json() if r["key"]}
        self.assertTrue(roles["platform_admin"]["all_permissions"])
        self.assertIn("transport.orders.manage", roles["platform_admin"]["permissions"])
        self.assertIn("transport.orders.create", roles["org_admin"]["permissions"])
        self.assertNotIn("transport.orders.create", roles["store"]["permissions"])
        # Their permission lists cannot be narrowed.
        kept = admin.put(
            f"/api/v1/roles/{roles['platform_admin']['id']}",
            json={"name": "Головний адміністратор", "scope": "platform", "permissions": []},
            headers=H,
        )
        self.assertEqual(kept.json()["name"], "Головний адміністратор")
        self.assertIn("platform.users.manage", kept.json()["permissions"])

    def test_own_password_change(self):
        clerk = self.login("clerk", "clerk-pass")
        changed = clerk.put("/api/v1/me/password", json={"password": "fresh-pass"}, headers=H)
        self.assertEqual(changed.status_code, 200)
        self.login("clerk", "fresh-pass")


if __name__ == "__main__":
    unittest.main()
