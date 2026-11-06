"""Generate golden data for the Go port from the Python implementation.

Run from the repository root:
    PYTHONPATH=backend uv run --locked --python python3.11 python testdata/reports/gen_golden.py
Writes testdata/reports/{money,pricing}.json. Review the diff by hand when it changes.
"""
import json
from pathlib import Path

from app.core.errors import FormError
from app.core.dependencies import to_cents
from app.modules.reports import pricing as pr

OUT = Path(__file__).parent

MONEY = [
    "0.125", "0.135", "0.145", "0.155", "0.005", "0.015", "2.675", "25,50", " 1 000.5", "1e2", "1E-2", "1e0",
    ".5", "5.", "+3", "-1", "-0", "-0.001", "NaN", "nan", "Infinity", "-Infinity", "inf", "1_000", "1e999999",
    "1000000000", "10000000.01", "10000000", "9999999.999", "", " ", "abc", "1,5,5", "1.2.3", "0", "00012.30",
    "1 000", "1 000", "\t5\n", "١٢", "1e2.5", "0x10", "1/2", "25.5", "25.50", "25.555", "25.545", "1e-3",
    "12345678901234567890", "0.1", "0.29", "1.005", "٣", "5 5", "1,000.50", "--1", "1e", "e1", ".", "+", "$5",
]

def money_case(s):
    try:
        return {"in": s, "cents": to_cents(s)}
    except FormError as e:
        return {"in": s, "error": e.message}
    except Exception as e:  # Python answers 500 here; Go returns the normal 422 form error instead
        return {"in": s, "python_crash": type(e).__name__}

HISTORIES = {
    "single": [("0000-00", 100)],
    "monthly": [("0000-00", 100), ("2026-03", 120), ("2026-05", 90)],
    "intra_month": [("0000-00", 100), ("2026-03", 120), ("2026-03_1", 130), ("2026-03_2", 120), ("2026-03_10", 140)],
    "legacy_hash": [("0000-00", 100), ("2026-03", 110), ("2026-03#2", 120), ("2026-03#abc", 125), ("2026-03_x", 126)],
    "unsorted": [("2026-05", 90), ("0000-00", 100), ("2026-03_2", 130), ("2026-03", 120), ("2026-03_1", 125)],
    "repeat": [("0000-00", 100), ("2026-04", 110), ("2026-04_1", 100), ("2026-04_2", 110)],
}
PERIODS = ["2025-12", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2030-01"]

def hist_json(h):
    return [[k, c] for k, c in h]

def pricing():
    out = {"sort_history": [], "offered": [], "timeline": [], "apply": [], "latest": [], "labels": []}
    for name, h in HISTORIES.items():
        out["sort_history"].append({"name": name, "in": hist_json(h), "out": hist_json(pr.sort_history(h))})
        out["latest"].append({"name": name, "in": hist_json(h), "out": pr.latest_price(h)})
        for p in PERIODS:
            out["offered"].append({"name": name, "period": p, "in": hist_json(h), "out": pr.offered_prices(h, p)})
            out["timeline"].append({"name": name, "period": p, "in": hist_json(h), "out": pr.month_price_timeline(h, p)})
            for cents in (100, 110, 120, 130, 777):
                try:
                    nh, prev, now = pr.apply_price_change(h, p, cents)
                    out["apply"].append({"name": name, "period": p, "cents": cents, "in": hist_json(h),
                                         "history": hist_json(nh), "previous": prev, "now": now})
                except ValueError as e:
                    out["apply"].append({"name": name, "period": p, "cents": cents, "in": hist_json(h), "error": str(e)})
    for derived, extra in [([], []), ([100], []), ([100, 110], []), ([100, 110, 120], []), ([100, 110], [90, 110]),
                           ([100], [50, 100, 60]), ([100, 110, 120, 130], [140])]:
        out["labels"].append({"derived": derived, "extra": extra, "out": [[p, l] for p, l in pr.line_labels(derived, extra)]})
    out["period_month"] = [{"in": s, "out": pr.period_month(s)} for s in
                           ["0000-00", "2026-03", "2026-03_1", "2026-03#2", "2026-03_a_b", "2026-03#a_b", ""]]
    return out

(OUT / "money.json").write_text(json.dumps([money_case(s) for s in MONEY], ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
(OUT / "pricing.json").write_text(json.dumps(pricing(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print("ok")
