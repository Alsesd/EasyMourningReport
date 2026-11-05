"""Unit tests for the administrator backup-download route."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

import app.platform.system.routes as backup_route
from app.platform.accounts.access import Principal
from app.platform.accounts.models import Role, User


def fake_request():
    request = MagicMock(spec=Request)
    request.client.host = "127.0.0.1"
    request.headers = {"host": "testserver"}
    request.session = {}
    return request


class BackupDownloadRouteTests(unittest.TestCase):
    def setUp(self):
        self.request = fake_request()
        user = User(id=1, login="admin", password_hash="hash")
        user.roles = [Role(name="Адміністратор", scope="platform", key="platform_admin")]
        self.user = Principal(user=user, permissions=frozenset({"platform.system.manage"}))
        self.db = MagicMock(spec=Session)

    def test_streams_snapshot_and_records_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            snapshot = Path(tmp) / "reports-snapshot.db"
            snapshot.write_bytes(b"sqlite snapshot")
            with patch.object(backup_route, "backup_db", return_value=snapshot), \
                 patch.object(backup_route, "audit") as audit:
                response = backup_route.download_backup_snapshot(self.request, self.user, self.db)
            self.assertEqual(Path(response.path), snapshot)
            self.assertIn("reports-snapshot.db", response.headers["content-disposition"])
            audit.assert_called_once_with(
                self.db, self.request, "admin", "Адміністратор", "завантажено бекап", snapshot.name
            )
            self.db.commit.assert_called_once_with()
            self.db.rollback.assert_not_called()


    def test_failed_snapshot_is_a_500_and_never_streams_the_live_database(self):
        for outcome in (None, RuntimeError("Backup failed its integrity check: corrupt")):
            kwargs = {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}
            with patch.object(backup_route, "backup_db", **kwargs):
                with self.assertRaises(HTTPException) as caught:
                    backup_route.download_backup_snapshot(self.request, self.user, self.db)
            self.assertEqual(caught.exception.status_code, 500)

    def test_audit_failure_does_not_fail_the_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            snapshot = Path(tmp) / "reports-snapshot.db"
            snapshot.write_bytes(b"sqlite snapshot")
            with patch.object(backup_route, "backup_db", return_value=snapshot), \
                 patch.object(backup_route, "audit", side_effect=RuntimeError("audit down")), \
                 patch.object(backup_route.logger, "exception") as log_exception:
                response = backup_route.download_backup_snapshot(self.request, self.user, self.db)
            self.assertEqual(Path(response.path), snapshot)
            self.db.rollback.assert_called_once_with()
            log_exception.assert_called_once()


if __name__ == "__main__":
    unittest.main()
