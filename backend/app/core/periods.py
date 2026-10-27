"""Shared money formatting and calendar-period helpers."""

from datetime import date


def money(cents: int) -> str:
    """Format integer cents as a decimal amount without a currency symbol."""
    return f"{cents / 100:.2f}"


def current_period() -> str:
    """Return the current local calendar month as YYYY-MM."""
    return date.today().strftime("%Y-%m")


def shift_period(period: str, delta: int) -> str:
    """Shift a YYYY-MM period by the given number of months."""
    year, month = map(int, period.split("-"))
    absolute_month = year * 12 + (month - 1) + delta
    return f"{absolute_month // 12:04d}-{absolute_month % 12 + 1:02d}"
