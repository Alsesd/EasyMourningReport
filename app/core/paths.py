"""Where the app keeps its persistent files (reports.db, secret.key, backups/).

Nuitka does not set sys.frozen, and in a onefile exe __file__ points into a temporary
folder that is deleted on exit, so data written there is lost. Nuitka exposes the folder that
holds the exe as __compiled__.containing_dir instead.
"""

import os
import sys
from pathlib import Path

APP_NAME = "LegkyiZvit"


def _app_dir() -> Path:
    """Folder of the exe (compiled build) or of the project (running from source)."""
    compiled = globals().get("__compiled__")
    if compiled is not None:
        folder = getattr(compiled, "containing_dir", None)
        return Path(folder) if folder else Path(sys.argv[0]).resolve().parent
    if getattr(sys, "frozen", False):  # other freezers, e.g. PyInstaller
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent.parent


def _user_data_dir() -> Path:
    if sys.platform == "win32":
        root = os.getenv("LOCALAPPDATA") or Path.home() / "AppData" / "Local"
    else:
        root = os.getenv("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    return Path(root) / APP_NAME


def _writable(folder: Path) -> bool:
    try:
        folder.mkdir(parents=True, exist_ok=True)
        probe = folder / f".write-test-{os.getpid()}"
        probe.write_text("ok")
        probe.unlink()
        return True
    except OSError:
        return False


def data_dir() -> Path:
    """Return the (created) folder for the database, secret key and backups.

    1. LEGKYI_DATA_DIR, if set, wins.
    2. Otherwise the folder next to the exe (or the project folder when run from source).
    3. If that folder is read-only (e.g. Program Files), %LOCALAPPDATA%\\LegkyiZvit is used.
    """
    override = os.getenv("LEGKYI_DATA_DIR")
    if override:
        folder = Path(override).expanduser().resolve()
        folder.mkdir(parents=True, exist_ok=True)  # an explicit setting should fail loudly
        return folder
    folder = _app_dir()
    if _writable(folder):
        return folder
    fallback = _user_data_dir()
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback
