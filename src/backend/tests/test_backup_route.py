"""Unit tests for the administrator backup-download route."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core import backup as backup_route
from app.features.auth.models import User


def fake_request():
    request = MagicMock(spec=Request)
    request.client.host = "127.0.0.1"
    request.headers = {"host": "testserver"}
    request.session = {}
    return request


class BackupDownloadRouteTests(unittest.TestCase):
    def setUp(self):
        self.request = fake_request()
        self.user = User(id=1, login="admin", password_hash="hash", role="admin")
        self.db = MagicMock(spec=Session)

    def test_streams_snapshot_and_records_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            snapshot = Path(tmp) / "reports-snapshot.sql"
            snapshot.write_text("-- sql snapshot", encoding="utf-8")
            with patch.object(backup_route, "backup_db", return_value=snapshot), \
                 patch.object(backup_route, "audit") as audit:
                response = backup_route.download_backup_snapshot(self.request, self.user, self.db)
            self.assertEqual(Path(response.path), snapshot)
            self.assertEqual(response.media_type, "application/sql")
            self.assertIn("reports-snapshot.sql", response.headers["content-disposition"])
            audit.assert_called_once_with(
                self.db, self.request, "admin", "admin", "завантажено бекап", "reports-snapshot.sql"
            )
            self.db.commit.assert_called_once_with()
            self.db.rollback.assert_not_called()

    def test_audit_failure_does_not_abort_successful_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            snapshot = Path(tmp) / "reports-snapshot.sql"
            snapshot.write_text("-- sql snapshot", encoding="utf-8")
            with patch.object(backup_route, "backup_db", return_value=snapshot), \
                 patch.object(backup_route, "audit", side_effect=RuntimeError("audit down")), \
                 patch.object(backup_route.logger, "exception") as log_exception:
                response = backup_route.download_backup_snapshot(self.request, self.user, self.db)
            self.assertEqual(Path(response.path), snapshot)
            self.assertEqual(response.media_type, "application/sql")
            self.db.rollback.assert_called_once_with()
            self.db.commit.assert_not_called()
            log_exception.assert_called_once()

    def test_missing_snapshot_returns_500(self):
        with patch.object(backup_route, "backup_db", return_value=None):
            with self.assertRaises(HTTPException) as caught:
                backup_route.download_backup_snapshot(self.request, self.user, self.db)
        self.assertEqual(caught.exception.status_code, 500)


if __name__ == "__main__":
    unittest.main()
