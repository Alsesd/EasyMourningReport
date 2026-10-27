"""Permission catalogue shared by user administration and session payloads."""

from __future__ import annotations

import json
from collections.abc import Iterable

PERMISSION_LABELS: dict[str, str] = {
    "transport_order": "Замовлення транспорту",
    "sales_report": "Звіт по продажу",
    "vehicle_dispatch": "Відправка машин",
    "driver": "Водій",
}

ALL_PERMISSIONS: tuple[str, ...] = tuple(PERMISSION_LABELS)


def normalize_permissions(values: Iterable[str] | None) -> list[str]:
    """Validate permission codes and return them in catalogue order."""
    requested = {str(value).strip() for value in (values or []) if str(value).strip()}
    unknown = sorted(requested - set(ALL_PERMISSIONS))
    if unknown:
        raise ValueError(f"Невідомі права доступу: {', '.join(unknown)}")
    return [code for code in ALL_PERMISSIONS if code in requested]


def decode_permissions(raw: str | None, role: str) -> list[str]:
    """Decode the persisted JSON list, with safe defaults for legacy users."""
    if role == "admin":
        return list(ALL_PERMISSIONS)
    try:
        values = json.loads(raw or "[]")
    except (TypeError, ValueError):
        values = []
    if not isinstance(values, list):
        values = []
    cleaned = [str(value) for value in values if str(value) in PERMISSION_LABELS]
    return cleaned or ["sales_report"]


def encode_permissions(values: Iterable[str]) -> str:
    return json.dumps(normalize_permissions(values), ensure_ascii=False)


__all__ = [
    "ALL_PERMISSIONS",
    "PERMISSION_LABELS",
    "decode_permissions",
    "encode_permissions",
    "normalize_permissions",
]
