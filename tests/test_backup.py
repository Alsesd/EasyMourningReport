import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from app.db import backup


class BackupTests(unittest.TestCase):
    def test_backup_can_be_opened_and_restored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "reports.db"
            backup_dir = root / "backups"
            with closing(sqlite3.connect(db_path)) as db:
                with db:
                    db.execute("CREATE TABLE example (value TEXT NOT NULL)")
                    db.execute("INSERT INTO example(value) VALUES (?)", ("preserved",))

            with patch.object(backup, "DB_PATH", db_path), patch.object(backup, "BACKUP_DIR", backup_dir):
                snapshot = backup.backup_db(tag="test")
                self.assertIsNotNone(snapshot)
                self.assertTrue(snapshot.is_file())
                with closing(sqlite3.connect(snapshot)) as restored:
                    self.assertEqual(restored.execute("SELECT value FROM example").fetchone(), ("preserved",))
                    self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_backup_is_skipped_when_database_has_not_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "reports.db"
            backup_dir = root / "backups"
            with closing(sqlite3.connect(db_path)) as db:
                with db:
                    db.execute("CREATE TABLE example (value INTEGER)")
                    db.execute("INSERT INTO example VALUES (1)")

            with patch.object(backup, "DB_PATH", db_path), patch.object(backup, "BACKUP_DIR", backup_dir):
                self.assertIsNotNone(backup.backup_db(tag="test"))
                self.assertIsNone(backup.backup_db())

    def test_retention_keeps_configured_number_of_snapshots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "reports.db"
            backup_dir = root / "backups"
            backup_dir.mkdir()
            with closing(sqlite3.connect(db_path)) as db:
                with db:
                    db.execute("CREATE TABLE example (value INTEGER)")
                    db.execute("INSERT INTO example VALUES (1)")
            for stamp in ("20000101-000001", "20000102-000001", "20000103-000001"):
                (backup_dir / f"reports-{stamp}.db").write_bytes(b"old snapshot")

            with patch.object(backup, "DB_PATH", db_path), patch.object(backup, "BACKUP_DIR", backup_dir), patch.object(backup, "KEEP", 2):
                backup.backup_db(tag="retention")
            self.assertEqual(len(list(backup_dir.glob("reports-*.db"))), 2)


if __name__ == "__main__":
    unittest.main()
