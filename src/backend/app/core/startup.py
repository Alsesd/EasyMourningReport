"""Console startup diagnostics for the source and container entrypoint."""

import os
import sys

from app.core.backup import BACKUP_DIR
from app.core.database import DATABASE_URL
from app.core.paths import data_dir


def print_startup_banner(host: str, port: int) -> None:
    data_folder = data_dir()
    storage_status = "OK (read/write)"
    for name, folder in (("Data", data_folder), ("Backups", BACKUP_DIR)):
        try:
            folder.mkdir(parents=True, exist_ok=True)
            probe = folder / f".probe_{os.getpid()}"
            probe.write_text("ok", encoding="utf-8")
            try:
                probe.unlink(missing_ok=True)
            except OSError:
                pass
        except OSError as exc:
            storage_status = "WARNING (restricted permissions)"
            print(
                f"  [STORAGE WARNING] {name} directory '{folder}' may have restricted permissions: {exc}",
                flush=True,
            )

    banner = f"""
======================================================================
  EasyMourningReport / Легкий звіт (v1.0.0)
  Enterprise Multi-Store Reporting & Analytics System
======================================================================
  • Data Directory : {data_folder}
  • Backups Dir    : {BACKUP_DIR}
  • Database URL   : {DATABASE_URL}
  • Storage Access : {storage_status}
  • Server Address : http://{host}:{port}
  • REST API       : http://{host}:{port}/api/v1
  • Web Interface  : http://{host}:{port}/
  • Platform       : {sys.platform} (Python {sys.version.split()[0]})
======================================================================
"""
    print(banner.strip(), flush=True)
    print(f"Data folder: {data_folder}", flush=True)


__all__ = ["print_startup_banner"]
