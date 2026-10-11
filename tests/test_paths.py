import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.core import paths


class DataDirTests(unittest.TestCase):
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

    def test_compiled_onefile_uses_folder_of_the_exe_not_the_temp_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = SimpleNamespace(containing_dir=tmp)
            with patch.object(paths, "__compiled__", fake, create=True), \
                    patch.dict(os.environ, {}, clear=False):
                os.environ.pop("LEGKYI_DATA_DIR", None)
                self.assertEqual(paths.data_dir(), Path(tmp))

    def test_read_only_exe_folder_falls_back_to_user_data_dir(self):
        with tempfile.TemporaryDirectory() as exe_dir, tempfile.TemporaryDirectory() as home:
            fake = SimpleNamespace(containing_dir=exe_dir)
            env = {"LOCALAPPDATA": home, "XDG_DATA_HOME": home}
            with patch.object(paths, "__compiled__", fake, create=True), \
                    patch.object(paths, "_writable", side_effect=lambda f: Path(f) != Path(exe_dir)), \
                    patch.dict(os.environ, env):
                os.environ.pop("LEGKYI_DATA_DIR", None)
                result = paths.data_dir()
            self.assertEqual(result, Path(home) / paths.APP_NAME)
            self.assertTrue(result.is_dir())

    def test_writable_reports_false_for_a_file_path(self):
        with tempfile.NamedTemporaryFile() as f:
            self.assertFalse(paths._writable(Path(f.name)))


if __name__ == "__main__":
    unittest.main()
