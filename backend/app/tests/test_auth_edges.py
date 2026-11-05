"""Authentication route edge cases using isolated SQLite sessions."""

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "unit-test-only-secret-key")

from fastapi import Request
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.platform.accounts.auth as auth
from app.db.base import Base
from app.platform.audit.models import AuditLog
from app.platform.accounts.testing import make_admin, make_member, make_organisation


def request_with_session(session=None):
    request = MagicMock(spec=Request)
    request.session = dict(session or {})
    request.client.host = "192.0.2.100"
    request.headers = {"host": "testserver"}
    return request


class AuthenticationEdgeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)
        with self.Session() as db:
            self.admin = make_admin(db, "admin", "admin-pass")
            self.active_store = make_organisation(db, "Active")
            self.archived_store = make_organisation(db, "Archived", archived=True)
            self.active_user = make_member(db, self.active_store, "shop1", "shop-pass")
            self.archived_user = make_member(db, self.archived_store, "shop2", "shop-pass")
            self.disabled_user = make_member(db, self.active_store, "shop3", "shop-pass", active=False)
            db.commit()
            self.admin_id, self.active_id, self.archived_id = self.admin.id, self.active_user.id, self.archived_user.id

    def tearDown(self):
        self.engine.dispose()

    def test_missing_login_is_rejected_and_failure_is_audited(self):
        with self.Session() as db, patch.object(auth, "retry_after", return_value=0), patch.object(auth, "record_failure") as record:
            response = auth.login_post(request_with_session(), "unknown", "x", db)
            self.assertEqual(response.status_code, 401)
            record.assert_called_once_with("192.0.2.100", "unknown")
            self.assertEqual(db.scalar(select(AuditLog.action)), "невдалий вхід")

    def test_rate_limit_returns_429_without_database_lookup(self):
        with self.Session() as db, patch.object(auth, "retry_after", return_value=42), patch.object(auth, "record_failure") as record:
            response = auth.login_post(request_with_session(), "ADMIN", "admin-pass", db)
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers["Retry-After"], "42")
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            record.assert_not_called()

    def test_archived_store_cannot_login(self):
        with self.Session() as db, patch.object(auth, "retry_after", return_value=0), patch.object(auth, "record_failure") as record:
            response = auth.login_post(request_with_session(), "shop2", "shop-pass", db)
            self.assertEqual(response.status_code, 403)
            self.assertIn("обліковий запис вимкнено", response.body.decode())
            record.assert_called_once_with("192.0.2.100", "shop2")
            self.assertEqual(db.scalar(select(AuditLog.detail)), "організація в архіві")

    def test_disabled_user_cannot_login(self):
        with self.Session() as db, patch.object(auth, "retry_after", return_value=0), patch.object(auth, "record_failure"):
            response = auth.login_post(request_with_session(), "shop3", "shop-pass", db)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(
                db.scalar(select(AuditLog.detail).where(AuditLog.login == "shop3")),
                "обліковий запис вимкнено",
            )

    def test_active_store_can_login_and_session_is_replaced(self):
        request = request_with_session({"old": "state", "uid": 999})
        with self.Session() as db, patch.object(auth, "retry_after", return_value=0), patch.object(auth, "clear_failures") as clear:
            response = auth.login_post(request, " SHOP1 ", "shop-pass", db)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/")
            self.assertEqual(request.session, {"uid": self.active_id})
            clear.assert_called_once_with("192.0.2.100", "shop1")
            self.assertEqual(db.scalar(select(AuditLog.action)), "вхід")

    def test_logout_without_session_user_still_clears_session(self):
        request = request_with_session({"other": "data"})
        with self.Session() as db:
            response = auth.logout(request, db)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/login")
            self.assertEqual(request.session, {})
            self.assertEqual(len(list(db.scalars(select(AuditLog)))), 0)


if __name__ == "__main__":
    unittest.main()
