"""Application startup and shutdown lifecycle."""

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.tunnel import shutdown as shutdown_tunnel
from app.core.tunnel import start_if_enabled as start_tunnel_if_enabled
from app.db.backup import backup_db, backup_loop
from app.db.bootstrap import migrate, seed


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Initialize persistent state, run periodic backups, and shut down cleanly."""
    migrate()
    seed()
    await asyncio.to_thread(backup_db)
    backup_sidecar_enabled = (
        os.getenv("BACKUP_SIDECAR_ENABLED", "0").strip().lower()
        in {"1", "true", "yes", "on"}
    )
    backup_task = (
        None
        if backup_sidecar_enabled
        else asyncio.create_task(backup_loop(), name="database-backup-loop")
    )
    try:
        # Restore the explicitly enabled app-specific public tunnel after a restart.
        await asyncio.to_thread(start_tunnel_if_enabled)
        yield
    finally:
        await asyncio.to_thread(shutdown_tunnel)
        if backup_task is not None:
            backup_task.cancel()
            try:
                await backup_task
            except asyncio.CancelledError:
                pass
        await asyncio.to_thread(backup_db)
