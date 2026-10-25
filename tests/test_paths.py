import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core import paths


class DataDirTests(unittest.TestCase):
    def test_asset_dir_prefers_existing_package_assets(self):
        expected = Path(paths.__file__).resolve().parent.parent / "templates"
        self.assertTrue(expected.is_dir())
        self.assertEqual(paths.asset_dir("templates"), expected)

    def test_asset_dir_frozen_build_uses_assets_next_to_executable(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_module = Path(tmp) / "lib" / "app" / "core" / "paths.py"
            fake_module.parent.mkdir(parents=True)
            fake_module.touch()
            expected = Path(tmp) / "app" / "templates"
            expected.mkdir(parents=True)
            executable = Path(tmp) / "LegkyiZvit.exe"
            with patch.object(paths, "__file__", str(fake_module)), \
                 patch.object(paths.sys, "frozen", True, create=True), \
                 patch.object(paths.sys, "executable", str(executable)):
                self.assertEqual(paths.asset_dir("templates"), expected)

    def test_asset_dir_source_returns_package_path_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_module = Path(tmp) / "app" / "core" / "paths.py"
            fake_module.parent.mkdir(parents=True)
            fake_module.touch()
            expected = Path(tmp) / "app" / "templates"
            with patch.object(paths, "__file__", str(fake_module)), \
                 patch.object(paths.sys, "frozen", False, create=True):
                self.assertEqual(paths.asset_dir("templates"), expected)

    def test_source_run_uses_project_folder(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LEGKYI_DATA_DIR", None)
            self.assertEqual(paths.data_dir(), Path(paths.__file__).resolve().parent.parent.parent)

    def test_env_override_is_created_and_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "nested" / "data"
            with patch.dict(os.environ, {"LEGKYI_DATA_DIR": str(target)}):
                self.assertEqual(paths.data_dir(), target.resolve())
            self.assertTrue(target.is_dir())

    def test_read_only_exe_folder_falls_back_to_user_data_dir(self):
        with tempfile.TemporaryDirectory() as exe_dir, tempfile.TemporaryDirectory() as home:
            executable = Path(exe_dir) / "app.exe"
            env = {"LOCALAPPDATA": home, "XDG_DATA_HOME": home}
            with patch.object(paths.sys, "frozen", True, create=True), \
                    patch.object(paths.sys, "executable", str(executable)), \
                    patch.object(paths, "_writable", side_effect=[False]), \
                    patch.dict(os.environ, env):
                os.environ.pop("LEGKYI_DATA_DIR", None)
                result = paths.data_dir()
            self.assertEqual(result, Path(home) / paths.APP_NAME)
            self.assertTrue(result.is_dir())

    def test_other_freezer_uses_executable_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            executable = Path(tmp) / "app.exe"
            with patch.object(paths.sys, "frozen", True, create=True), \
                 patch.object(paths.sys, "executable", str(executable)):
                self.assertEqual(paths._app_dir(), executable.resolve().parent)

    def test_windows_user_data_folder(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(paths.sys, "platform", "win32"), \
             patch.dict(os.environ, {"LOCALAPPDATA": tmp}, clear=False):
            os.environ.pop("XDG_DATA_HOME", None)
            self.assertEqual(paths._user_data_dir(), Path(tmp) / paths.APP_NAME)

    def test_linux_user_data_folder_falls_back_to_home_without_xdg(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(paths.sys, "platform", "linux"), \
             patch.object(Path, "home", return_value=Path(tmp)), \
             patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                paths._user_data_dir(),
                Path(tmp) / ".local" / "share" / paths.APP_NAME,
            )

    def test_user_data_dir_honors_override_and_creates_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "private" / "state"
            with patch.dict(os.environ, {"LEGKYI_DATA_DIR": str(target)}):
                self.assertEqual(paths.user_data_dir(), target.resolve())
            self.assertTrue(target.is_dir())

    def test_user_data_dir_uses_per_user_fallback_without_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / paths.APP_NAME
            with patch.dict(os.environ, {}, clear=True), \
                 patch.object(paths, "_user_data_dir", return_value=target):
                self.assertEqual(paths.user_data_dir(), target)
            self.assertTrue(target.is_dir())

    def test_writable_reports_false_for_a_file_path(self):
        with tempfile.NamedTemporaryFile() as f:
            self.assertFalse(paths._writable(Path(f.name)))

    def test_user_data_dir_handles_chmod_oserror_gracefully(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "private" / "state"
            with patch.dict(os.environ, {"LEGKYI_DATA_DIR": str(target)}), \
                 patch.object(paths.os, "name", "posix"), \
                 patch.object(Path, "chmod", side_effect=OSError("Operation not permitted")):
                result = paths.user_data_dir()
                self.assertEqual(result, target.resolve())
                self.assertTrue(result.is_dir())



if __name__ == "__main__":
    unittest.main()
