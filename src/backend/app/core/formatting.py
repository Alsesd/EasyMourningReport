"""Presentation-safe formatting helpers shared by API responses and exports."""


def money(cents: int) -> str:
    return f"{cents / 100:.2f}"


__all__ = ["money"]
