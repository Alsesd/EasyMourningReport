"""Application startup and shutdown: schema, first admin, backups and the public tunnel."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db.backup import backup_db, backup_loop, integrity_check
from app.db.session import checkpoint
from app.platform.bootstrap import migrate, seed
import app.platform.system.tunnel as tunnel

logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verdict = await asyncio.to_thread(integrity_check)
    if verdict != "ok":
        # Keep serving so data can still be exported, but make the problem impossible to miss.
        logger.error("DATABASE INTEGRITY CHECK FAILED: %s. Restore the newest backup from the backups folder.", verdict)
    migrate()
    seed()
    await asyncio.to_thread(backup_db)
    backups = asyncio.create_task(backup_loop(), name="database-backup-loop")
    try:
        await asyncio.to_thread(tunnel.start_if_enabled)
        yield
    finally:
        await asyncio.to_thread(tunnel.shutdown)
        backups.cancel()
        try:
            await backups
        except asyncio.CancelledError:
            pass
        await asyncio.to_thread(checkpoint)
        await asyncio.to_thread(backup_db)
