"""Lazy public database facade.

Keep stable imports such as `from app.db import Product, get_db` without
importing the entire database, bootstrap, and service graph during package
initialization. Lazy exports avoid circular imports between bootstrap and
service modules.
"""

from importlib import import_module
from typing import Any

_EXPORTS = {
    # Submodules
    "backup": "app.db.backup",
    "bootstrap": "app.db.bootstrap",
    "repositories": "app.db.repositories",
    # Database primitives
    "Base": "app.db.base",
    "BASE_DIR": "app.db.session",
    "DB_PATH": "app.db.session",
    "SessionLocal": "app.db.session",
    "engine": "app.db.session",
    "get_db": "app.db.session",
    # Startup and backup
    "backup_db": "app.db.backup",
    "backup_loop": "app.db.backup",
    "migrate": "app.db.bootstrap",
    "seed": "app.db.bootstrap",
    # Models
    "AuditLog": "app.db.models",
    "Product": "app.db.models",
    "ProductPrice": "app.db.models",
    "Report": "app.db.models",
    "ReportItem": "app.db.models",
    "Store": "app.db.models",
    "User": "app.db.models",
    # Common repository facade
    "audit": "app.db.repositories.audit",
}

__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
    module_name = _EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(module_name)
    value = module if name in {"backup", "bootstrap", "repositories"} else getattr(module, name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
