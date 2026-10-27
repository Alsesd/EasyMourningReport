"""Calendar period helpers used by reports, pricing, and API responses."""

from datetime import date


def current_period() -> str:
    return date.today().strftime("%Y-%m")


def shift_period(period: str, delta: int) -> str:
    year, month = map(int, period.split("-"))
    number = year * 12 + (month - 1) + delta
    return f"{number // 12:04d}-{number % 12 + 1:02d}"


__all__ = ["current_period", "shift_period"]
