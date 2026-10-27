"""Authentication edge cases against isolated SQLite sessions."""

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "unit-test-only-secret-key")

from fastapi import Request
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.features.auth.service as auth_service
from app.core.database import Base
from app.core.security import hash_pw
from app.features.audit.models import AuditLog
from app.features.auth.models import User
from app.features.stores.models import Store


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
            self.admin = User(login="admin", password_hash=hash_pw("admin-pass"), role="admin")
            self.active_store = Store(name="Active")
            self.archived_store = Store(name="Archived", archived=True)
            db.add_all([self.admin, self.active_store, self.archived_store])
            db.flush()
            self.active_user = User(login="shop1", password_hash=hash_pw("shop-pass"), role="store", store_id=self.active_store.id)
            self.archived_user = User(login="shop2", password_hash=hash_pw("shop-pass"), role="store", store_id=self.archived_store.id)
            db.add_all([self.active_user, self.archived_user])
            db.commit()
            self.admin_id, self.active_id, self.archived_id = self.admin.id, self.active_user.id, self.archived_user.id

    def tearDown(self):
        self.engine.dispose()

    def test_missing_login_is_rejected_and_failure_is_audited(self):
        with self.Session() as db, patch.object(auth_service, "retry_after", return_value=0), patch.object(auth_service, "record_failure") as record:
            result = auth_service.authenticate_credentials(request_with_session(), "unknown", "x", db)
            self.assertEqual(result.status_code, 401)
            record.assert_called_once_with("192.0.2.100", "unknown")
            self.assertEqual(db.scalar(select(AuditLog.action)), "невдалий вхід")

    def test_rate_limit_returns_429_without_database_lookup(self):
        with self.Session() as db, patch.object(auth_service, "retry_after", return_value=42), patch.object(auth_service, "record_failure") as record:
            result = auth_service.authenticate_credentials(request_with_session(), "ADMIN", "admin-pass", db)
            self.assertEqual(result.status_code, 429)
            self.assertEqual(result.retry_after_seconds, 42)
            record.assert_not_called()

    def test_archived_store_cannot_login(self):
        with self.Session() as db, patch.object(auth_service, "retry_after", return_value=0), patch.object(auth_service, "record_failure") as record:
            result = auth_service.authenticate_credentials(request_with_session(), "shop2", "shop-pass", db)
            self.assertEqual(result.status_code, 403)
            self.assertIn("обліковий запис вимкнено", result.error)
            record.assert_called_once_with("192.0.2.100", "shop2")
            self.assertEqual(db.scalar(select(AuditLog.detail)), "магазин в архіві")

    def test_active_store_can_login_and_session_is_replaced(self):
        request = request_with_session({"old": "state", "uid": 999})
        with self.Session() as db, patch.object(auth_service, "retry_after", return_value=0), patch.object(auth_service, "clear_failures") as clear:
            result = auth_service.authenticate_credentials(request, " SHOP1 ", "shop-pass", db)
            self.assertTrue(result.is_success)
            self.assertEqual(request.session, {"uid": self.active_id})
            clear.assert_called_once_with("192.0.2.100", "shop1")
            self.assertEqual(db.scalar(select(AuditLog.action)), "вхід")

    def test_logout_without_session_user_still_clears_session(self):
        request = request_with_session({"other": "data"})
        with self.Session() as db:
            auth_service.logout_user(request, db)
            self.assertEqual(request.session, {})
            self.assertEqual(len(list(db.scalars(select(AuditLog)))), 0)


if __name__ == "__main__":
    unittest.main()
