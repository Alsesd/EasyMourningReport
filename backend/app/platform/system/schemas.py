"""System administration DTOs."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.core.schemas import DTO


class TunnelStatusDTO(DTO):
    enabled: bool
    autostart: bool
    has_token: bool
    state: Literal["disabled", "stopped", "starting", "running", "error"]
    public_url: str = ""
    error: str = ""


class TunnelStartDTO(BaseModel):
    confirm_public: bool
    autostart: bool = True
    # A Cloudflare tunnel token; empty keeps the saved one (or opens a Quick Tunnel when none exists).
    token: str | None = Field(default=None, max_length=4096)


class TunnelAutostartDTO(BaseModel):
    enabled: bool


class BackupDTO(DTO):
    name: str
    size_bytes: int
    created_at: datetime


class SystemHealthDTO(DTO):
    database_ok: bool
    integrity: str
    journal_mode: str
    database_size_bytes: int
    backups_count: int
    last_backup_at: datetime | None = None
    backup_every_min: int
