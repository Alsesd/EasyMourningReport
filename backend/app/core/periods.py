"""Shared money formatting and calendar-period helpers."""

from datetime import date


def money(cents: int) -> str:
    """Format integer cents as a decimal amount without a currency symbol."""
    return f"{cents / 100:.2f}"


def current_period() -> str:
    """Return the current local calendar month as YYYY-MM."""
    return date.today().strftime("%Y-%m")
