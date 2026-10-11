"""Lazy public service facade for pricing and Excel operations."""

from importlib import import_module
from typing import Any

_EXPORTS = {
    "excel": "app.services.excel",
    "pricing": "app.services.pricing",
    "BASE_PERIOD": "app.services.pricing",
    "History": "app.services.pricing",
    "apply_price_change": "app.services.pricing",
    "dedupe_logins": "app.services.pricing",
    "latest_price": "app.services.pricing",
    "line_labels": "app.services.pricing",
    "norm_login": "app.services.pricing",
    "norm_name": "app.services.pricing",
    "offered_prices": "app.services.pricing",
    "period_month": "app.services.pricing",
    "same_name": "app.services.pricing",
    "valid_login": "app.services.pricing",
    "generate_summary_excel": "app.services.excel",
    "parse_products_excel": "app.services.excel",
}

__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
    module_name = _EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(module_name)
    value = module if name in {"excel", "pricing"} else getattr(module, name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
