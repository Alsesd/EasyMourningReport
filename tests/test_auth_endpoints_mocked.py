"""Unit tests for auth endpoints with mocked dependencies (no ASGI, no real DB)."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.routes.auth import login_post, logout


class AuthEndpointTests(unittest.TestCase):
    """Test auth route handlers with mocked request, db, and utility functions."""

    @patch("app.routes.auth.clear_failures")
    @patch("app.routes.auth.audit")
    @patch("app.routes.auth.record_failure")
    @patch("app.routes.auth.check_pw", return_value=True)
    @patch("app.routes.auth.retry_after", return_value=0)
    @patch("app.routes.auth.client_ip", return_value="127.0.0.1")
    @patch("app.routes.auth.norm_login", return_value="admin")
    def test_login_post_success_redirects_and_sets_session(
        self,
        mock_norm_login,
        mock_client_ip,
        mock_retry_after,
        mock_check_pw,
        mock_record_failure,
        mock_audit,
        mock_clear_failures,
    ):
        """Successful login: redirect to /, set session uid, audit, clear failures."""
        request = MagicMock()
        request.session = {}
        db = MagicMock()
        user = SimpleNamespace(
            id=42,
            login="admin",
            role="admin",
            password_hash="hash",
            store=None,
        )
        db.scalar.return_value = user

        response = login_post(request, "admin", "secret", db)

        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/")
        self.assertEqual(request.session["uid"], 42)
        mock_record_failure.assert_not_called()
        mock_clear_failures.assert_called_once_with("127.0.0.1", "admin")
        mock_audit.assert_called_once()
        db.commit.assert_called_once()

    @patch("app.routes.auth.clear_failures")
    @patch("app.routes.auth.audit")
    @patch("app.routes.auth.record_failure")
    @patch("app.routes.auth.check_pw", return_value=False)
    @patch("app.routes.auth.retry_after", return_value=0)
    @patch("app.routes.auth.client_ip", return_value="127.0.0.1")
    @patch("app.routes.auth.norm_login", return_value="admin")
    def test_login_post_invalid_password_renders_401(
        self,
        mock_norm_login,
        mock_client_ip,
        mock_retry_after,
        mock_check_pw,
        mock_record_failure,
        mock_audit,
        mock_clear_failures,
    ):
        """Invalid password: return 401, record failure, audit, don't clear."""
        request = MagicMock()
        request.session = {}
        db = MagicMock()

        user = SimpleNamespace(
            id=42,
            login="admin",
            role="admin",
            password_hash="hash",
            store=None,
        )
        db.scalar.return_value = user

        response = login_post(request, "admin", "wrong", db)

        self.assertEqual(response.status_code, 401)
        self.assertIn("Неправильний логін", response.body.decode())
        mock_record_failure.assert_called_once_with("127.0.0.1", "admin")
        mock_audit.assert_called_once()
        mock_clear_failures.assert_not_called()
        db.commit.assert_called_once()

    @patch("app.routes.auth.clear_failures")
    @patch("app.routes.auth.audit")
    @patch("app.routes.auth.record_failure")
    @patch("app.routes.auth.check_pw", return_value=True)
    @patch("app.routes.auth.retry_after", return_value=0)
    @patch("app.routes.auth.client_ip", return_value="127.0.0.1")
    @patch("app.routes.auth.norm_login", return_value="store")
    def test_login_post_archived_store_rejected(
        self,
        mock_norm_login,
        mock_client_ip,
        mock_retry_after,
        mock_check_pw,
        mock_record_failure,
        mock_audit,
        mock_clear_failures,
    ):
        """Archived store user: return 403, record failure, don't set session."""
        request = MagicMock()
        request.session = {}
        db = MagicMock()

        user = SimpleNamespace(
            id=7,
            login="store",
            role="store",
            password_hash="hash",
            store=SimpleNamespace(archived=True),
        )
        db.scalar.return_value = user

        response = login_post(request, "store", "secret", db)

        self.assertEqual(response.status_code, 403)
        self.assertIn("вимкнено", response.body.decode())
        mock_record_failure.assert_called_once_with("127.0.0.1", "store")
        mock_audit.assert_called_once()
        mock_clear_failures.assert_not_called()
        self.assertNotIn("uid", request.session)

    @patch("app.routes.auth.audit")
    @patch("app.routes.auth.record_failure")
    @patch("app.routes.auth.check_pw", return_value=True)
    @patch("app.routes.auth.retry_after", return_value=2)
    @patch("app.routes.auth.client_ip", return_value="127.0.0.1")
    @patch("app.routes.auth.norm_login", return_value="admin")
    def test_login_post_rate_limited_returns_429(
        self,
        mock_norm_login,
        mock_client_ip,
        mock_retry_after,
        mock_check_pw,
        mock_record_failure,
        mock_audit,
    ):
        """Rate limit exceeded (retry_after > 0): return 429 with Retry-After."""
        request = MagicMock()
        request.session = {}
        db = MagicMock()

        response = login_post(request, "admin", "secret", db)

        self.assertEqual(response.status_code, 429)
        self.assertIn("Забагато", response.body.decode())
        self.assertEqual(response.headers["Retry-After"], "2")
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        mock_record_failure.assert_not_called()
        mock_audit.assert_not_called()

    @patch("app.routes.auth.audit")
    @patch("app.routes.auth.record_failure")
    @patch("app.routes.auth.check_pw", return_value=True)
    @patch("app.routes.auth.retry_after", return_value=0)
    @patch("app.routes.auth.client_ip", return_value="127.0.0.1")
    @patch("app.routes.auth.norm_login", return_value="admin")
    def test_logout_clears_session_and_audits(
        self,
        mock_norm_login,
        mock_client_ip,
        mock_retry_after,
        mock_check_pw,
        mock_record_failure,
        mock_audit,
    ):
        """Logout: clear session, redirect to /login, audit action."""
        request = MagicMock()
        request.session = {"uid": 42}
        db = MagicMock()
        user = SimpleNamespace(id=42, login="admin", role="admin")
        db.get.return_value = user

        response = logout(request, db)

        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/login")
        self.assertEqual(request.session, {})
        mock_audit.assert_called_once()
        db.commit.assert_called_once()

    @patch("app.routes.auth.audit")
    def test_logout_without_session_still_redirects(
        self, mock_audit
    ):
        """Logout without uid in session: still redirect to /login, no audit."""
        request = MagicMock()
        request.session = {}
        db = MagicMock()
        db.get.return_value = None

        response = logout(request, db)

        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/login")
        self.assertEqual(request.session, {})
        mock_audit.assert_not_called()
        db.get.assert_not_called()  # No session uid, so no DB lookup
        db.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
