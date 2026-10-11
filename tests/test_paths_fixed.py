"""Unit tests for app.core.paths with comprehensive mocking for all branches."""

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.core import paths


class PathsUnitTests(unittest.TestCase):
    """Test all branches of paths.py without relying on real filesystem state."""

    def test_asset_dir_prefers_existing_package_assets(self):
        """When assets exist in source tree, use them (source build)."""
        expected = Path(paths.__file__).resolve().parent.parent / "templates"
        self.assertTrue(expected.is_dir())
        self.assertEqual(paths.asset_dir("templates"), expected)

    def test_asset_dir_frozen_build_uses_assets_next_to_executable(self):
        """When sys.frozen=True and assets missing in source, use exe folder."""
        with tempfile.TemporaryDirectory() as tmp:
            fake_module = Path(tmp) / "lib" / "app" / "core" / "paths.py"
            fake_module.parent.mkdir(parents=True, exist_ok=True)
            fake_module.touch()

            expected = Path(tmp) / "app" / "templates"
            expected.mkdir(parents=True, exist_ok=True)

            executable = Path(tmp) / "LegkyiZvit.exe"

            with (
                patch.object(paths, "__file__", str(fake_module)),
                patch.object(paths.sys, "frozen", True, create=True),
                patch.object(paths.sys, "executable", str(executable)),
            ):
                self.assertEqual(paths.asset_dir("templates"), expected)

    def test_asset_dir_source_returns_package_path_when_missing(self):
        """When running from source and assets missing, return package path anyway."""
        with tempfile.TemporaryDirectory() as tmp:
            fake_module = Path(tmp) / "app" / "core" / "paths.py"
            fake_module.parent.mkdir(parents=True, exist_ok=True)
            fake_module.touch()

            expected = Path(tmp) / "app" / "templates"

            with (
                patch.object(paths, "__file__", str(fake_module)),
                patch.object(paths.sys, "frozen", False, create=True),
            ):
                self.assertEqual(paths.asset_dir("templates"), expected)

    def test_source_run_uses_project_folder(self):
        """When running from source without LEGKYI_DATA_DIR, use project root."""
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LEGKYI_DATA_DIR", None)
            result = paths.data_dir()
            # Should be 3 levels up from paths.py (app/core/paths.py -> project root)
            expected = Path(paths.__file__).resolve().parent.parent.parent
            self.assertEqual(result, expected)

    def test_env_override_is_created_and_wins(self):
        """LEGKYI_DATA_DIR env var overrides everything; folder is created."""
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "nested" / "data"
            with patch.dict(os.environ, {"LEGKYI_DATA_DIR": str(target)}):
                result = paths.data_dir()
                self.assertEqual(result, target.resolve())
            self.assertTrue(target.is_dir())

    def test_compiled_onefile_uses_folder_of_the_exe_not_the_temp_dir(self):
        """PyOxidizer with containing_dir: use containing_dir, not temp extraction dir."""
        with tempfile.TemporaryDirectory() as tmp:
            fake = SimpleNamespace(containing_dir=tmp)
            with (
                patch.object(paths, "__compiled__", fake, create=True),
                patch.dict(os.environ, {}, clear=False),
            ):
                os.environ.pop("LEGKYI_DATA_DIR", None)
                result = paths.data_dir()
                self.assertEqual(result, Path(tmp))

    def test_read_only_exe_folder_falls_back_to_user_data_dir(self):
        """If exe folder not writable, fall back to %LOCALAPPDATA%/LegkyiZvit."""
        with tempfile.TemporaryDirectory() as exe_dir, tempfile.TemporaryDirectory() as home:
            fake = SimpleNamespace(containing_dir=exe_dir)
            env = {"LOCALAPPDATA": home, "XDG_DATA_HOME": home}
            with (
                patch.object(paths, "__compiled__", fake, create=True),
                patch.object(
                    paths,
                    "_writable",
                    side_effect=lambda f: Path(f) != Path(exe_dir),
                ),
                patch.dict(os.environ, env),
            ):
                os.environ.pop("LEGKYI_DATA_DIR", None)
                result = paths.data_dir()
            self.assertEqual(result, Path(home) / paths.APP_NAME)
            self.assertTrue(result.is_dir())

    def test_other_freezer_uses_executable_folder(self):
        """PyInstaller (sys.frozen=True, no __compiled__): use sys.executable parent."""
        with tempfile.TemporaryDirectory() as tmp:
            executable = Path(tmp) / "app.exe"
            with (
                patch.object(paths, "__compiled__", None, create=True),
                patch.object(paths.sys, "frozen", True, create=True),
                patch.object(paths.sys, "executable", str(executable)),
            ):
                result = paths._app_dir()
                self.assertEqual(result, executable.resolve().parent)

    def test_compiled_build_without_containing_dir_uses_argv_folder(self):
        """PyOxidizer without containing_dir: use sys.argv[0] parent."""
        with tempfile.TemporaryDirectory() as tmp:
            executable = Path(tmp) / "app.exe"
            with (
                patch.object(paths, "__compiled__", SimpleNamespace(), create=True),
                patch.object(paths.sys, "argv", [str(executable)]),
            ):
                result = paths._app_dir()
                self.assertEqual(result, executable.resolve().parent)

    def test_windows_user_data_folder(self):
        """On Windows, use LOCALAPPDATA or AppData/Local."""
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(paths.sys, "platform", "win32"),
                patch.dict(os.environ, {"LOCALAPPDATA": tmp}, clear=False),
            ):
                os.environ.pop("XDG_DATA_HOME", None)
                result = paths._user_data_dir()
                self.assertEqual(result, Path(tmp) / paths.APP_NAME)

    def test_linux_user_data_folder_with_xdg(self):
        """On Linux with XDG_DATA_HOME, use it."""
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(paths.sys, "platform", "linux"),
                patch.dict(os.environ, {"XDG_DATA_HOME": tmp}, clear=False),
            ):
                os.environ.pop("LOCALAPPDATA", None)
                result = paths._user_data_dir()
                self.assertEqual(result, Path(tmp) / paths.APP_NAME)

    def test_linux_user_data_folder_falls_back_to_home_without_xdg(self):
        """On Linux without XDG_DATA_HOME, use ~/.local/share."""
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(paths.sys, "platform", "linux"),
                patch.object(Path, "home", return_value=Path(tmp)),
                patch.dict(os.environ, {}, clear=True),
            ):
                result = paths._user_data_dir()
                self.assertEqual(
                    result,
                    Path(tmp) / ".local" / "share" / paths.APP_NAME,
                )

    def test_writable_returns_true_for_writable_dir(self):
        """_writable() creates dir and probe file, returns True on success."""
        with tempfile.TemporaryDirectory() as tmp:
            test_dir = Path(tmp) / "writable_test"
            self.assertTrue(paths._writable(test_dir))
            self.assertTrue(test_dir.is_dir())
            # Probe file should be cleaned up
            probe = test_dir / f".write-test-{os.getpid()}"
            self.assertFalse(probe.exists())

    def test_writable_reports_false_for_a_file_path(self):
        """_writable() returns False when given a file (not directory)."""
        with tempfile.NamedTemporaryFile() as f:
            self.assertFalse(paths._writable(Path(f.name)))

    def test_source_root_points_to_app_directory(self):
        """_source_root() should return the app/ directory."""
        result = paths._source_root()
        self.assertTrue(result.is_dir())
        self.assertEqual(result.name, "app")
        # Verify it has expected subdirs
        self.assertTrue((result / "core").is_dir())


if __name__ == "__main__":
    unittest.main()
