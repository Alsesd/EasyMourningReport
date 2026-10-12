"""Resolve persistent data outside the bundled runtime and extraction directory.

Use the executable's directory when writable; otherwise fall back to the per-user
application data directory. Never store mutable application data inside PyInstaller's
temporary one-file extraction directory.
"""

import os
import sys
from pathlib import Path

APP_NAME = "LegkyiZvit"


def _app_dir() -> Path:
    """Folder of the executable when frozen, or the project root in source mode."""
    if getattr(sys, "frozen", False):
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
    """Return per-user storage suitable for private identity and credential state.

    Honor LEGKYI_DATA_DIR as an explicit all-data override so tests and portable
    deployments can isolate every persistent artifact in one known location.
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
