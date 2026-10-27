"""Unit tests for PostgreSQL backup utility and retention management."""

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session

from app.core import backup
from app.core.database import Base
from app.features.stores.models import Store


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.engine_patch = patch.object(backup, "engine", self.engine)
        self.engine_patch.start()

    def tearDown(self):
        self.engine_patch.stop()
        self.engine.dispose()

    def test_backup_generates_valid_sql_dump(self):
        with tempfile.TemporaryDirectory() as tmp:
            backup_dir = Path(tmp) / "backups"
            with Session(self.engine) as db:
                db.add(Store(name="Test Store Preserved", archived=False))
                db.commit()

            with patch.object(backup, "BACKUP_DIR", backup_dir):
                snapshot = backup.backup_db(tag="test")
                self.assertIsNotNone(snapshot)
                self.assertTrue(snapshot.is_file())
                self.assertTrue(snapshot.name.endswith(".sql"))
                content = snapshot.read_text(encoding="utf-8")
                self.assertIn("-- EasyMourningReport", content)
                self.assertIn("Test Store Preserved", content)
                self.assertIn("INSERT INTO stores", content)

    def test_background_loop_offloads_backup_and_can_be_cancelled(self):
        async def run():
            with patch.object(
                backup.asyncio,
                "sleep",
                new=AsyncMock(side_effect=[None, asyncio.CancelledError()]),
            ), patch.object(
                backup.asyncio, "to_thread", new=AsyncMock(return_value=None)
            ) as to_thread:
                with self.assertRaises(asyncio.CancelledError):
                    await backup.backup_loop()
                to_thread.assert_awaited_once_with(backup.backup_db)

        asyncio.run(run())

    def test_retention_keeps_configured_number_of_snapshots(self):
        with tempfile.TemporaryDirectory() as tmp:
            backup_dir = Path(tmp) / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            for stamp in ("20000101-000001", "20000102-000001", "20000103-000001"):
                (backup_dir / f"reports-{stamp}.sql").write_text("-- old snapshot", encoding="utf-8")

            with patch.object(backup, "BACKUP_DIR", backup_dir), patch.object(backup, "KEEP", 2):
                backup.backup_db(tag="retention")
            self.assertEqual(len(list(backup_dir.glob("reports-*.sql"))), 2)

    def test_get_backup_dir_supports_backups_path_and_nested_parents(self):
        with tempfile.TemporaryDirectory() as tmp:
            custom_path = Path(tmp) / "nested" / "custom_backups"
            with patch.dict(backup.os.environ, {"BACKUPS_PATH": str(custom_path)}):
                resolved = backup._get_backup_dir()
                self.assertEqual(resolved, custom_path.resolve())

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            nested_backup_dir = root / "deeply" / "nested" / "backups"
            with patch.object(backup, "BACKUP_DIR", nested_backup_dir):
                result = backup.backup_db(tag="nested")
                self.assertIsNotNone(result)
                self.assertTrue(nested_backup_dir.is_dir())
                self.assertTrue(result.is_file())
                self.assertTrue(result.name.endswith(".sql"))

    def test_get_backup_dir_strips_quotes(self):
        with tempfile.TemporaryDirectory() as tmp:
            custom_path = Path(tmp) / "quoted_backups"
            with patch.dict(backup.os.environ, {"BACKUPS_PATH": f'"{custom_path}"'}):
                resolved = backup._get_backup_dir()
                self.assertEqual(resolved, custom_path.resolve())

    def test_backup_db_handles_unlink_oserror_during_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            backup_dir = Path(tmp) / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            for stamp in ("20000101-000001", "20000102-000001"):
                (backup_dir / f"reports-{stamp}.sql").write_text("-- old", encoding="utf-8")

            with patch.object(backup, "BACKUP_DIR", backup_dir), \
                 patch.object(backup, "KEEP", 1), \
                 patch.object(Path, "unlink", side_effect=OSError("Locked")):
                res = backup.backup_db(tag="prune-test")
                self.assertIsNotNone(res)


if __name__ == "__main__":
    unittest.main()
