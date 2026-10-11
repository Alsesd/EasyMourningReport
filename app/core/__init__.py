"""Core infrastructure utilities for EasyMourningReport."""

from app.core import paths, ratelimit, security, ui
from app.core.paths import _app_dir, asset_dir, data_dir
from app.core.ratelimit import clear_failures, record_failure, retry_after
from app.core.security import (
    check_pw,
    client_ip,
    hash_pw,
    load_secret,
    same_origin_post_guard,
)
from app.core.ui import (
    FormError,
    current_period,
    done,
    flash,
    money,
    render,
    safe_referer,
    shift_period,
)

__all__ = [
    "FormError",
    "_app_dir",
    "asset_dir",
    "admin_period",
    "admin_required",
    "check_pw",
    "clean_login",
    "clean_name",
    "clear_failures",
    "client_ip",
    "current_period",
    "data_dir",
    "dependencies",
    "done",
    "flash",
    "get_db",
    "hash_pw",
    "load_secret",
    "money",
    "new_password",
    "parse_period",
    "paths",
    "ratelimit",
    "record_failure",
    "render",
    "retry_after",
    "safe_referer",
    "same_origin_post_guard",
    "security",
    "shift_period",
    "store_required",
    "to_cents",
    "ui",
    "user_required",
]

_DEFERRED = {
    "dependencies": "app.core.dependencies",
    "get_db": "app.core.dependencies",
    "user_required": "app.core.dependencies",
    "admin_required": "app.core.dependencies",
    "store_required": "app.core.dependencies",
    "admin_period": "app.core.dependencies",
    "parse_period": "app.core.dependencies",
    "to_cents": "app.core.dependencies",
    "clean_name": "app.core.dependencies",
    "clean_login": "app.core.dependencies",
    "new_password": "app.core.dependencies",
}


def __getattr__(name: str):
    if name in _DEFERRED:
        import importlib

        mod = importlib.import_module(_DEFERRED[name])
        val = mod if name == "dependencies" else getattr(mod, name)
        globals()[name] = val
        return val
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
