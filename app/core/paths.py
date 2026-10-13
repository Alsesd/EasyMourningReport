"""Resolve persistent data outside the one-file freezer extraction directory.

When the executable folder is not writable, use the per-user application data directory.
"""

import os
import sys
from pathlib import Path

APP_NAME = "LegkyiZvit"


def _app_dir() -> Path:
    """Folder of the exe (compiled build) or of the project (running from source)."""
    if getattr(sys, "frozen", False):  # PyInstaller and compatible freezers
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent.parent


def asset_dir(name: str) -> Path:
    """Find a packaged template/static directory in source and frozen layouts."""
    package_assets = Path(__file__).parent.parent / name
    if package_assets.is_dir():
        return package_assets
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "app" / name
    return package_assets


def _user_data_dir() -> Path:
    if sys.platform == "win32":
        root = os.getenv("LOCALAPPDATA") or Path.home() / "AppData" / "Local"
    else:
        root = os.getenv("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    return Path(root) / APP_NAME


def user_data_dir() -> Path:
    """Return private per-user storage for Tailscale identity and helper state.

    LEGKYI_DATA_DIR intentionally overrides the location so portable installs and
    tests can keep identity state alongside the rest of the application's data.
    """
    override = os.getenv("LEGKYI_DATA_DIR")
    folder = Path(override).expanduser().resolve() if override else _user_data_dir()
    folder.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        folder.chmod(0o700)
    return folder


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
