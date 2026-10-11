"""Price-history rules and login normalisation (pure functions, no framework imports).

Price model
-----------
A product has a *price history*: a list of (period, price_cents) records, where ``period`` is the
month ("YYYY-MM") from which that price is in force. The first record uses BASE_PERIOD, so every
product always has a price for every month.

A report for month X offers these price lines for a product:
  * the price in force in X (the latest record with period <= X);
  * plus the price that was in force *before* it, but only when a price change starts exactly in X.

So in the month of a change the product has two lines (old price, new price) for every store -
whether or not any quantity was saved, and including stores created later. In later months only
the new price remains; earlier months keep the old price.
"""
from __future__ import annotations

import re

BASE_PERIOD = "0000-00"  # "since always": the price a product was created with

History = list[tuple[str, int]]  # [(period, price_cents), ...] sorted by period


def offered_prices(history: History, period: str) -> list[int]:
    """Prices a report for ``period`` must offer, in display order (old price first, then new)."""
    in_force = None
    for i, (start, _) in enumerate(history):
        if start <= period:
            in_force = i
    if in_force is None:
        return []
    start, price = history[in_force]
    if start == period and in_force > 0:
        return [history[in_force - 1][1], price]
    return [price]


def apply_price_change(history: History, period: str, new_cents: int) -> tuple[History, int, int]:
    """Return (new_history, price_before_this_month, price_in_force_after_change).

    The change applies from ``period`` (the month in which the admin makes it):
      * a second change in the same month replaces the first one (the "old" price stays the price
        from before the month, so there are never more than two lines);
      * changing back to the price from before the month cancels the change (one line again);
      * nothing happens if the price in force already equals ``new_cents``.
    """
    hist = sorted(history)
    before = [p for s, p in hist if s < period]
    if not before:
        raise ValueError("history has no price before this period")
    prev_price = before[-1]
    current = {s: p for s, p in hist}
    in_force = current.get(period, prev_price)
    if new_cents == in_force:
        return hist, prev_price, in_force
    if new_cents == prev_price:
        current.pop(period, None)
    else:
        current[period] = new_cents
    return sorted(current.items()), prev_price, new_cents


def latest_price(history: History) -> int:
    return sorted(history)[-1][1]


def line_labels(derived: list[int], extra: list[int]) -> list[tuple[int, str]]:
    """(price, label) for each input line of a product. Labels: 'old', 'new', 'saved', ''.

    ``extra`` are prices already saved in the report that are not among the offered prices (data from
    the previous revaluation logic, or saved between two price edits); they are kept so nothing is lost.
    """
    if len(derived) == 2:
        lines = [(derived[0], "old"), (derived[1], "new")]
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
