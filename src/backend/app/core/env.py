"""Minimal .env loading for local source runs and `python -m app`."""

import os
from pathlib import Path

from app.core.paths import project_root


def _strip_inline_comment(value: str) -> str:
    """Drop a trailing ``# comment`` while preserving quoted hashes."""
    quote = ""
    for index, character in enumerate(value):
        if character in ("'", '"'):
            if quote == character:
                quote = ""
            elif not quote:
                quote = character
        elif character == "#" and not quote and (index == 0 or value[index - 1].isspace()):
            return value[:index].rstrip()
    return value


def load_env_file(env_path: Path | None = None) -> None:
    """Load KEY=VALUE pairs without overriding variables already in the environment."""
    target = env_path or project_root() / ".env"
    if not target.is_file():
        return
    try:
        for line in target.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = _strip_inline_comment(value.strip()).strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        pass


__all__ = ["load_env_file"]
