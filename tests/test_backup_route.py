"""Unit tests for the administrator backup-download route."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

import app.routes.admin.backup as backup_route
from app.db.models.user import User


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
            snapshot = Path(tmp) / "reports-snapshot.db"
            snapshot.write_bytes(b"sqlite snapshot")
            with patch.object(backup_route, "backup_db", return_value=snapshot), \
                 patch.object(backup_route, "audit") as audit:
                response = backup_route.download_backup_snapshot(self.request, self.user, self.db)
            self.assertEqual(response.path, snapshot)
            self.assertIn("reports-snapshot.db", response.headers["content-disposition"])
            audit.assert_called_once_with(
                self.db, self.request, "admin", "admin", "завантажено бекап", snapshot.name
            )
            self.db.commit.assert_called_once_with()
            self.db.rollback.assert_not_called()

    def test_falls_back_to_live_database_if_snapshot_is_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_file = Path(tmp) / "reports.db"
            db_file.write_bytes(b"database")
            with patch.object(backup_route, "backup_db", return_value=None), \
                 patch.object(backup_route, "DB_PATH", db_file), \
                 patch.object(backup_route, "audit", side_effect=RuntimeError("audit down")), \
                 patch.object(backup_route.logger, "exception") as log_exception:
                response = backup_route.download_backup_snapshot(self.request, self.user, self.db)
            self.assertEqual(response.path, db_file)
            self.db.rollback.assert_called_once_with()
            self.db.commit.assert_not_called()
            log_exception.assert_called_once()

    def test_missing_snapshot_and_missing_database_returns_500(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "reports.db"
            with patch.object(backup_route, "backup_db", return_value=None), \
                 patch.object(backup_route, "DB_PATH", missing):
                with self.assertRaises(HTTPException) as caught:
                    backup_route.download_backup_snapshot(self.request, self.user, self.db)
            self.assertEqual(caught.exception.status_code, 500)

    def test_nonexistent_snapshot_falls_back_to_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_file = Path(tmp) / "reports.db"
            db_file.write_bytes(b"database")
            snapshot = Path(tmp) / "deleted-snapshot.db"
            with patch.object(backup_route, "backup_db", return_value=snapshot), \
                 patch.object(backup_route, "DB_PATH", db_file), \
                 patch.object(backup_route, "audit"):
                response = backup_route.download_backup_snapshot(self.request, self.user, self.db)
            self.assertEqual(response.path, db_file)


if __name__ == "__main__":
    unittest.main()
