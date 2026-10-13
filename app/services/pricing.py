"""Price-history rules and login normalisation (pure functions, no framework imports).

Price model
-----------
A product has a *price history*: a list of (period, price_cents) records, where ``period`` is the
month ("YYYY-MM") from which that price is in force. The first record uses BASE_PERIOD, so every
product always has a price for every month.

A report for month X offers these price lines for a product:
  * the price in force in X (the latest record with period <= X);
  * plus the price that was in force *before* it, but only when a price change starts exactly in X.

When there are multiple price changes in month X (e.g. period keys with suffixes like 'YYYY-MM_1'),
all applicable prices in that month are offered (old price followed by each new price).
"""
from __future__ import annotations

import re

BASE_PERIOD = "0000-00"  # "since always": the price a product was created with

History = list[tuple[str, int]]  # [(period, price_cents), ...] sorted by period


def period_month(p: str) -> str:
    """Return YYYY-MM for both canonical and within-month history keys."""
    separators = [i for i in (p.find("_"), p.find("#")) if i >= 0]
    return p[:min(separators)] if separators else p


def _sequence(period_key: str) -> tuple[int, str]:
    """Sequence number and suffix for a price-change key.

    The bare YYYY-MM key is the first change that month; older rows may use
    underscore or hash suffixes. Numeric suffixes sort numerically (not lexically).
    """
    month = period_month(period_key)
    if len(period_key) == len(month):
        return 0, ""
    suffix = period_key[len(month) + 1 :]
    return (int(suffix), suffix) if suffix.isdigit() else (0, suffix)


def _history_sort_key(period_key: str) -> tuple[str, int, int, str]:
    month = period_month(period_key)
    if len(period_key) == len(month):
        return month, 0, 0, ""
    seq, suffix = _sequence(period_key)
    return month, 1, seq, suffix


def sort_history(history: History) -> History:
    """Sort by month, then by the within-month price-change sequence."""
    return sorted(history, key=lambda item: _history_sort_key(item[0]))


def offered_prices(history: History, period: str) -> list[int]:
    """Return every distinct price that was in force at some point in this month.

    The previous month's closing price comes first, followed by each price recorded
    during the selected month. Repeated values are included once: changing back to
    a previous price remains a history event but does not create duplicate report rows.
    """
    hist = sort_history(history)
    before = [cents for start, cents in hist if period_month(start) < period]
    current_month = [
        cents for start, cents in hist if period_month(start) == period
    ]
    offered: list[int] = []
    if before:
        offered.append(before[-1])
    for cents in current_month:
        if cents not in offered:
            offered.append(cents)
    return offered


def apply_price_change(
    history: History, period: str, new_cents: int
) -> tuple[History, int, int]:
    """Append a real price change while preserving all earlier changes this month.

    Each product can have any number of price changes per month. The initial record
    for a month uses YYYY-MM; subsequent records use YYYY-MM_1, YYYY-MM_2, etc.
    Suffixes are ordered numerically. A no-op is ignored, but returning to an earlier
    price is recorded as another change so the full monthly price sequence survives.
    """
    hist = sort_history(history)
    before = [item for item in hist if period_month(item[0]) < period]
    if not before:
        raise ValueError("history has no price before this period")

    previous_month_price = before[-1][1]
    current_month = [
        (key, cents) for key, cents in hist if period_month(key) == period
    ]
    current_price = current_month[-1][1] if current_month else previous_month_price
    if new_cents == current_price:
        return hist, previous_month_price, current_price

    if not current_month:
        key = period
    else:
        used = {key for key, _ in current_month}
        sequence = max((_sequence(key)[0] for key, _ in current_month), default=0) + 1
        key = f"{period}_{sequence}"
        while key in used:
            sequence += 1
            key = f"{period}_{sequence}"

    new_history = sort_history([*hist, (key, new_cents)])
    return new_history, previous_month_price, new_cents


def latest_price(history: History) -> int:
    ordered = sort_history(history)
    if not ordered:
        raise ValueError("history is empty")
    return ordered[-1][1]


def line_labels(derived: list[int], extra: list[int]) -> list[tuple[int, str]]:
    """(price, label) for each input line of a product. Labels: 'old', 'new', 'saved', ''.

    ``extra`` are prices already saved in the report that are not among the offered prices (data from
    the previous revaluation logic, or saved between two price edits); they are kept so nothing is lost.
    """
    if len(derived) == 2:
        lines = [(derived[0], "old"), (derived[1], "new")]
    elif len(derived) > 2:
        lines = [(derived[0], "old")] + [(p, "new") for p in derived[1:]]
    else:
        lines = [(p, "") for p in derived]
    lines += [(p, "saved") for p in extra if p not in derived]
    return lines


# ---------- logins / names ----------
LOGIN_RE = re.compile(r"\S{2,40}")


def norm_login(raw: str) -> str:
    """Logins are case-insensitive and trimmed: 'Store1 ' and 'store1' are the same login."""
    return (raw or "").strip().lower()


def valid_login(login: str) -> bool:
    return bool(LOGIN_RE.fullmatch(login))


def norm_name(raw: str) -> str:
    return " ".join((raw or "").split())


def same_name(a: str, b: str) -> bool:
    return norm_name(a).casefold() == norm_name(b).casefold()


def dedupe_logins(logins: list[tuple[int, str]]) -> dict[int, str]:
    """Migration helper: map user id -> normalised login, making colliding ones unique with a suffix."""
    out: dict[int, str] = {}
    taken: set[str] = set()
    for uid, raw in sorted(logins):
        new = norm_login(raw) or f"user{uid}"
        if new in taken:
            new = f"{new}-{uid}"
        taken.add(new)
        out[uid] = new
    return out
