"""Run periodic SQLite backups outside the web server process.

The sidecar uses the same online-backup implementation as the API and startup hooks,
so there is only one backup format, retention policy, and database path implementation.
"""

from __future__ import annotations

import asyncio
import logging

from app.db.backup import EVERY_MIN, backup_db

logger = logging.getLogger("app.backup_sidecar")


async def run() -> None:
    """Take an initial snapshot, then periodically back up changes."""
    try:
        result = await asyncio.to_thread(backup_db)
        if result:
            logger.info("Created startup backup: %s", result)
    except Exception:  # sidecar should keep trying if a transient I/O error occurs
        logger.exception("Initial database backup failed")

    while True:
        await asyncio.sleep(max(1, EVERY_MIN) * 60)
        try:
            result = await asyncio.to_thread(backup_db)
            if result:
                logger.info("Created database backup: %s", result)
        except Exception:
            logger.exception("Scheduled database backup failed")


def main() -> None:
    """Start the sidecar's persistent backup loop."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    asyncio.run(run())


if __name__ == "__main__":
    main()
