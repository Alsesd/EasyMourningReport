"""Empirical stress tests for PostgreSQL backup utility and download route.

Covers:
1. backup_db() table dump fallback when pg_dump is missing (ANSI SQL compliance)
2. Handling of complex characters (single quotes, unicode, newlines, nulls, booleans)
3. Retention pruning under various conditions (KEEP=5, KEEP=1, non-sql preservation)
4. GET /admin/backup/download with admin authentication, media_type, and attachment headers
5. Authorization boundaries (store user 403, unauthenticated 303 redirect)
6. Error handling and audit log resilience
"""

import datetime
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session

from app.core import backup
from app.core.database import Base
from app.features.audit.models import AuditLog
from app.features.auth.dependencies import api_admin_required, api_user_required
from app.features.auth.models import User
from app.features.products.models import Product, ProductPrice
from app.features.reports.models import Report, ReportItem
from app.features.stores.models import Store
from app.main import app


class BackupFallbackStressTests(unittest.TestCase):
    def setUp(self):
        # Create an in-memory database with StaticPool to share connection
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.engine_patch = patch.object(backup, "engine", self.engine)
        self.engine_patch.start()

    def tearDown(self):
        self.engine_patch.stop()
        self.engine.dispose()

    def test_backup_db_fallback_produces_valid_ansi_sql(self):
        """Verify that when pg_dump is missing, programmatic table dump produces valid ANSI SQL INSERTs."""
        # Seed all tables with complex data
        with Session(self.engine) as db:
            store = Store(name="Кафе 'У Світлани' & Co. \"Мрія\"", archived=False)
            db.add(store)
            db.commit()
            db.refresh(store)

            user = User(
                login="admin_stress",
                password_hash="pbkdf2_sha256$29000$stress_salt$hash_value",
                role="admin",
                store_id=store.id,
            )
            db.add(user)

            product = Product(
                name="Хліб 'Бородинський' 500г (№1)",
                price_cents=3250,
                active=True,
                archived=False,
            )
            db.add(product)
            db.commit()
            db.refresh(product)

            price = ProductPrice(
                product_id=product.id,
                period="2026-10",
                price_cents=3250,
            )
            db.add(price)

            report = Report(
                store_id=store.id,
                period="2026-10",
                status="submitted",
            )
            db.add(report)
            db.commit()
            db.refresh(report)

            item = ReportItem(
                report_id=report.id,
                product_id=product.id,
                quantity=10,
                unit_price_cents=3250,
            )
            db.add(item)

            audit_log = AuditLog(
                login=user.login,
                role=user.role,
                action="тест 'стрес'",
                detail="Деталі операції з лапками: 'value' та \\символи\\\nНовий рядок",
                ip="127.0.0.1",
                ts=datetime.datetime(2026, 10, 26, 21, 30, 0, tzinfo=datetime.timezone.utc),
            )
            db.add(audit_log)
            db.commit()

        with tempfile.TemporaryDirectory() as tmp:
            backup_dir = Path(tmp) / "backups"

            # Force pg_dump to be None (fallback mode)
            with patch("shutil.which", return_value=None), \
                 patch.object(backup, "BACKUP_DIR", backup_dir):
                result_path = backup.backup_db(tag="fallback-stress")

            self.assertIsNotNone(result_path, "backup_db returned None in fallback mode")
            self.assertTrue(result_path.is_file(), "Backup file was not created on disk")
            self.assertTrue(result_path.name.endswith(".sql"), "Backup file must have .sql extension")

            sql_content = result_path.read_text(encoding="utf-8")

            # 1. Verify header comment
            self.assertIn("-- EasyMourningReport SQL Backup:", sql_content)

            # 2. Verify all seeded tables are present
            for tbl in ["stores", "users", "products", "product_prices", "reports", "report_items", "audit_log"]:
                self.assertIn(f"-- Table: {tbl}", sql_content)
                self.assertIn(f"INSERT INTO {tbl}", sql_content)

            # 3. Verify escaping of single quotes in data
            self.assertIn("''У Світлани''", sql_content)
            self.assertIn("''Бородинський''", sql_content)
            self.assertIn("''стрес''", sql_content)

            # 4. Verify boolean literals (TRUE / FALSE)
            self.assertIn("FALSE", sql_content)
            self.assertIn("TRUE", sql_content)

            # 5. Execute the generated SQL statements against a clean database to verify ANSI SQL syntax validity!
            verify_engine = create_engine("sqlite:///:memory:")
            # Recreate empty tables schema on verify_engine
            Base.metadata.create_all(verify_engine)

            # Parse and execute only the INSERT statements from the dump
            # Group lines since comments or details might have newlines inside values
            statements = []
            curr_stmt = []
            for line in sql_content.splitlines():
                if line.startswith("--"):
                    continue
                if not line.strip() and not curr_stmt:
                    continue
                curr_stmt.append(line)
                if line.strip().endswith(";"):
                    statements.append("\n".join(curr_stmt))
                    curr_stmt = []

            self.assertGreater(len(statements), 0, "No SQL statements found in dump")

            with verify_engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))

                # Verify data was restored correctly
                res = conn.execute(text("SELECT name FROM stores")).scalar()
                self.assertEqual(res, "Кафе 'У Світлани' & Co. \"Мрія\"")

                res_prod = conn.execute(text("SELECT name FROM products")).scalar()
                self.assertEqual(res_prod, "Хліб 'Бородинський' 500г (№1)")

                res_audit = conn.execute(text("SELECT detail FROM audit_log")).scalar()
                self.assertEqual(res_audit, "Деталі операції з лапками: 'value' та \\символи\\\nНовий рядок")

            verify_engine.dispose()

    def test_retention_pruning_keeps_exact_number_and_preserves_non_sql(self):
        """Verify retention pruning keeps only latest KEEP files and does not touch other files."""
        with tempfile.TemporaryDirectory() as tmp:
            backup_dir = Path(tmp) / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)

            # Create 15 synthetic backup files with increasing timestamps
            created_files = []
            for i in range(1, 16):
                fn = f"reports-20261026-{i:06d}.sql"
                p = backup_dir / fn
                p.write_text(f"-- Backup {i}", encoding="utf-8")
                created_files.append(p)

            # Also create non-sql files (legacy .db, logs, text)
            legacy_db = backup_dir / "reports-legacy.db"
            legacy_db.write_text("sqlite binary dummy", encoding="utf-8")
            other_txt = backup_dir / "notes.txt"
            other_txt.write_text("some notes", encoding="utf-8")

            # Run backup with KEEP=5
            with patch("shutil.which", return_value=None), \
                 patch.object(backup, "BACKUP_DIR", backup_dir), \
                 patch.object(backup, "KEEP", 5):
                new_backup = backup.backup_db(tag="retention-test")

            # Check .sql files remaining
            sql_files = sorted(backup_dir.glob("reports-*.sql"))
            self.assertEqual(len(sql_files), 5, f"Expected exactly 5 .sql files, got {len(sql_files)}")

            # Check that the new backup is among the kept files
            self.assertIn(new_backup, sql_files)

            # Check that non-sql files were NOT pruned
            self.assertTrue(legacy_db.exists(), "Legacy .db file was erroneously pruned")
            self.assertTrue(other_txt.exists(), "Other text file was erroneously pruned")

    def test_retention_pruning_with_keep_1(self):
        """Verify retention pruning when KEEP=1."""
        with tempfile.TemporaryDirectory() as tmp:
            backup_dir = Path(tmp) / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)

            for i in range(1, 5):
                (backup_dir / f"reports-20261026-{i:06d}.sql").write_text("-- old", encoding="utf-8")

            with patch("shutil.which", return_value=None), \
                 patch.object(backup, "BACKUP_DIR", backup_dir), \
                 patch.object(backup, "KEEP", 1):
                new_backup = backup.backup_db(tag="keep-1")

            sql_files = list(backup_dir.glob("reports-*.sql"))
            self.assertEqual(len(sql_files), 1)
            self.assertEqual(sql_files[0], new_backup)

    def test_backup_handles_sql_injection_payloads(self):
        """Verify that strings containing SQL injection payloads are safely escaped in ANSI SQL."""
        malicious_name = "Store '; DROP TABLE stores; -- ' OR 1=1"
        with Session(self.engine) as db:
            store = Store(name=malicious_name, archived=False)
            db.add(store)
            db.commit()

        with tempfile.TemporaryDirectory() as tmp:
            backup_dir = Path(tmp) / "backups"
            with patch("shutil.which", return_value=None), \
                 patch.object(backup, "BACKUP_DIR", backup_dir):
                out = backup.backup_db(tag="injection-test")

            self.assertIsNotNone(out)
            content = out.read_text(encoding="utf-8")
            # Escaped single quotes
            self.assertIn("''", content)

            # Test execution in fresh db
            verify_engine = create_engine("sqlite:///:memory:")
            Base.metadata.create_all(verify_engine)
            statements = [
                line.strip() for line in content.splitlines()
                if line.strip().startswith("INSERT INTO stores") and line.strip().endswith(";")
            ]
            with verify_engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                res = conn.execute(text("SELECT name FROM stores WHERE name = :n"), {"n": malicious_name}).scalar()
                self.assertEqual(res, malicious_name)
            verify_engine.dispose()

    def test_backup_db_pg_dump_command_args_and_env(self):
        """Verify that when pg_dump is present and DB is postgresql, pg_dump is invoked correctly."""
        with tempfile.TemporaryDirectory() as tmp:
            backup_dir = Path(tmp) / "backups"
            mock_url = MagicMock()
            mock_url.database = "mourningreport"
            mock_url.drivername = "postgresql+psycopg"
            mock_url.host = "postgres.internal"
            mock_url.port = 5433
            mock_url.username = "custom_user"
            mock_url.password = "secret_pass"

            mock_engine = MagicMock()
            mock_engine.url = mock_url

            with patch("shutil.which", return_value="/usr/bin/pg_dump"), \
                 patch.object(backup, "engine", mock_engine), \
                 patch.object(backup, "BACKUP_DIR", backup_dir), \
                 patch("subprocess.run") as mock_subproc:

                def fake_run(cmd, env, check, capture_output):
                    # Write fake dump to dest file specified by -f
                    f_idx = cmd.index("-f")
                    Path(cmd[f_idx + 1]).write_text("-- pg_dump snapshot", encoding="utf-8")

                mock_subproc.side_effect = fake_run

                res = backup.backup_db(tag="pgdump-test")
                self.assertIsNotNone(res)
                self.assertTrue(res.is_file())

                # Verify command arguments
                cmd = mock_subproc.call_args[0][0]
                self.assertEqual(cmd[0], "/usr/bin/pg_dump")
                self.assertIn("-h", cmd)
                self.assertEqual(cmd[cmd.index("-h") + 1], "postgres.internal")
                self.assertIn("-p", cmd)
                self.assertEqual(cmd[cmd.index("-p") + 1], "5433")
                self.assertIn("-U", cmd)
                self.assertEqual(cmd[cmd.index("-U") + 1], "custom_user")
                self.assertIn("-d", cmd)
                self.assertEqual(cmd[cmd.index("-d") + 1], "mourningreport")
                self.assertIn("--no-owner", cmd)
                self.assertIn("--no-acl", cmd)

                # Verify PGPASSWORD env variable
                env = mock_subproc.call_args[1]["env"]
                self.assertEqual(env.get("PGPASSWORD"), "secret_pass")

    def test_backup_db_pg_dump_failure_returns_none_and_cleans_up(self):
        """Verify that when pg_dump subprocess fails, backup_db returns None and cleans up destination file."""
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            backup_dir = Path(tmp) / "backups"
            mock_url = MagicMock()
            mock_url.database = "mourningreport"
            mock_url.drivername = "postgresql+psycopg"

            mock_engine = MagicMock()
            mock_engine.url = mock_url

            with patch("shutil.which", return_value="/usr/bin/pg_dump"), \
                 patch.object(backup, "engine", mock_engine), \
                 patch.object(backup, "BACKUP_DIR", backup_dir), \
                 patch("subprocess.run", side_effect=subprocess.CalledProcessError(1, ["pg_dump"])):

                res = backup.backup_db(tag="fail-test")
                self.assertIsNone(res)
                self.assertEqual(len(list(backup_dir.glob("*.sql"))), 0)


class BackupRouteStressTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)
        self.admin_user = User(id=1, login="admin", password_hash="hash", role="admin")

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_admin_download_returns_sql_and_attachment_headers(self):
        """GET /admin/backup/download with admin returns 200, media_type application/sql, and attachment headers."""
        with tempfile.TemporaryDirectory() as tmp:
            dummy_sql = Path(tmp) / "reports-20261026-snapshot.sql"
            dummy_sql.write_text("-- dummy sql content\nINSERT INTO stores VALUES (1, 'Test', 0);", encoding="utf-8")

            app.dependency_overrides[api_admin_required] = lambda: self.admin_user

            with patch("app.core.backup.backup_db", return_value=dummy_sql), \
                 patch("app.core.backup.audit") as mock_audit:
                response = self.client.get(
                    "/admin/backup/download",
                    headers={"Accept": "application/sql"},
                )

                self.assertEqual(response.status_code, 200)
                # Verify Content-Type
                self.assertIn("application/sql", response.headers.get("content-type", ""))
                # Verify Content-Disposition attachment header
                content_disp = response.headers.get("content-disposition", "")
                self.assertIn("attachment", content_disp)
                self.assertIn("reports-snapshot.sql", content_disp)
                # Verify body content
                self.assertEqual(response.text, dummy_sql.read_text(encoding="utf-8"))
                # Verify audit call
                mock_audit.assert_called_once()

    def test_store_user_forbidden(self):
        """GET /admin/backup/download with store role user returns 403 Forbidden."""
        store_user = User(id=2, login="store1", password_hash="hash", role="store")
        app.dependency_overrides[api_user_required] = lambda: store_user
        response = self.client.get("/admin/backup/download", follow_redirects=False)
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_user_rejected(self):
        """GET /admin/backup/download without a session returns JSON 401."""
        app.dependency_overrides.clear()
        response = self.client.get("/admin/backup/download", follow_redirects=False)
        self.assertEqual(response.status_code, 401)
        self.assertIn("application/json", response.headers.get("content-type", ""))

    def test_backup_failure_returns_500(self):
        """If backup_db() returns None, endpoint returns 500."""
        app.dependency_overrides[api_admin_required] = lambda: self.admin_user
        with patch("app.core.backup.backup_db", return_value=None):
            response = self.client.get("/admin/backup/download")
            self.assertEqual(response.status_code, 500)
            self.assertIn("Не вдалося створити резервну копію", response.text)

    def test_audit_failure_does_not_block_download(self):
        """Failure to write audit log does not abort download or return error."""
        with tempfile.TemporaryDirectory() as tmp:
            dummy_sql = Path(tmp) / "reports-20261026-snapshot.sql"
            dummy_sql.write_text("-- dummy sql content", encoding="utf-8")

            app.dependency_overrides[api_admin_required] = lambda: self.admin_user

            with patch("app.core.backup.backup_db", return_value=dummy_sql), \
                 patch("app.core.backup.audit", side_effect=RuntimeError("Database audit failed")):
                response = self.client.get("/admin/backup/download")
                self.assertEqual(response.status_code, 200)
                self.assertIn("application/sql", response.headers.get("content-type", ""))
                self.assertEqual(response.text, "-- dummy sql content")


if __name__ == "__main__":
    unittest.main()
