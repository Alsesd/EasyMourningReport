"""Generate the XLSX golden corpus for the Go port from the Python implementation.

Run from the repository root:
    PYTHONPATH=backend uv run --locked --python python3.11 python testdata/reports/gen_xlsx_golden.py
Writes testdata/reports/xlsx/*.xlsx (import fixtures), xlsx_import.json (what Python makes of each) and
xlsx_export.json (an openpyxl read-back of generate_summary_excel for fixed states).
"""
import io
import json
import zipfile
from pathlib import Path
from unittest.mock import MagicMock

from fastapi import HTTPException
from openpyxl import Workbook, load_workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.modules.reports.excel import parse_products_excel
from app.modules.reports.models import Product
from app.platform.accounts.models import User
from app.platform.audit.models import AuditLog

OUT = Path(__file__).parent
FIX = OUT / "xlsx"

# ---- a tiny raw xlsx writer, so every cell type can be produced exactly --------------------------------

STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/><numFmt numFmtId="165" formatCode="&quot;d&quot;0"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>"""


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cell(ref, spec):
    """spec: None | ("n", text[, style]) | ("s", text) | ("inline", text) | ("b", "1") | ("e", "#N/A")
    | ("fn", formula, cached_number) | ("fs", formula, cached_text) | ("f", formula) | ("sst", index)"""
    if spec is None:
        return ""
    kind = spec[0]
    if kind == "n":
        style = f' s="{spec[2]}"' if len(spec) > 2 else ""
        return f'<c r="{ref}"{style}><v>{spec[1]}</v></c>'
    if kind == "inline":
        return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{esc(spec[1])}</t></is></c>'
    if kind == "sst":
        return f'<c r="{ref}" t="s"><v>{spec[1]}</v></c>'
    if kind == "b":
        return f'<c r="{ref}" t="b"><v>{spec[1]}</v></c>'
    if kind == "e":
        return f'<c r="{ref}" t="e"><v>{spec[1]}</v></c>'
    if kind == "fn":
        return f'<c r="{ref}"><f>{esc(spec[1])}</f><v>{spec[2]}</v></c>'
    if kind == "fs":
        return f'<c r="{ref}" t="str"><f>{esc(spec[1])}</f><v>{esc(spec[2])}</v></c>'
    if kind == "f":
        return f'<c r="{ref}"><f>{esc(spec[1])}</f></c>'
    raise ValueError(kind)


def raw_xlsx(sheets, active=0, shared=()):
    """sheets: list of (title, {row_number: (A_spec, B_spec)})."""
    parts = {}
    parts["[Content_Types].xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + "".join(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(len(sheets)))
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        "</Types>"
    )
    parts["_rels/.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    )
    parts["xl/workbook.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<bookViews><workbookView activeTab="{active}"/></bookViews><sheets>'
        + "".join(f'<sheet name="{esc(t)}" sheetId="{i+1}" r:id="rId{i+1}"/>' for i, (t, _) in enumerate(sheets))
        + "</sheets></workbook>"
    )
    n = len(sheets)
    parts["xl/_rels/workbook.xml.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i+1}.xml"/>' for i in range(n))
        + f'<Relationship Id="rId{n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        f'<Relationship Id="rId{n+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'
    )
    parts["xl/styles.xml"] = STYLES
    parts["xl/sharedStrings.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared)}" uniqueCount="{len(shared)}">'
        + "".join(f'<si><t xml:space="preserve">{esc(s)}</t></si>' for s in shared)
        + "</sst>"
    )
    for i, (_, rows) in enumerate(sheets):
        body = ""
        for r in sorted(rows):
            a, b = rows[r]
            body += f'<row r="{r}">{cell(f"A{r}", a)}{cell(f"B{r}", b)}</row>'
        parts[f"xl/worksheets/sheet{i+1}.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f"<sheetData>{body}</sheetData></worksheet>"
        )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    return buf.getvalue()


def op_xlsx(rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def one(rows, **kw):
    return raw_xlsx([("Sheet1", rows)], **kw)


S = lambda t: ("inline", t)
N = lambda t, *st: ("n", t, *st)

FIXTURES = {
    "plain_header_en": op_xlsx([["Name", "Price"], ["Bread", 1.25], [" Bread ", 9.99], ["Milk", 2], [None, None]]),
    "header_uk_nazva": op_xlsx([["Назва", "Ціна"], ["Сир", 100.5]]),
    "header_tovar": op_xlsx([["  ТОВАР ", "x"], ["Сир", 3]]),
    "header_product": op_xlsx([["Product", None], ["Сир", 3]]),
    "header_word_in_row2": op_xlsx([["Сир", 3], ["Name", 4]]),
    "no_header": op_xlsx([["Сир", 3], ["Масло", "4,50"]]),
    "text_price_comma": op_xlsx([["Сир", "25,50"], ["Масло", " 1 000.5 "]]),
    "float_noise": op_xlsx([["A", 0.1 + 0.2], ["B", 2.675], ["C", 0.285], ["D", 1.005]]),
    "float_excel_repr": one({1: (S("A"), N("2.6749999999999998")), 2: (S("B"), N("0.30000000000000004")), 3: (S("C"), N("1E-3"))}),
    "float_exp_prices": one({1: (S("A"), N("1e2")), 2: (S("B"), N("1E+2")), 3: (S("C"), N("5E-1")), 4: (S("D"), N("1.5E1"))}),
    "int_cells": one({1: (S("A"), N("25")), 2: (S("B"), N("0")), 3: (S("C"), N("10000000"))}),
    "price_too_big": one({1: (S("A"), N("10000000.01"))}),
    "price_negative": one({1: (S("A"), N("-1"))}),
    "price_bool": one({1: (S("A"), ("b", "1")), 2: (S("B"), ("b", "0"))}),
    "price_missing": one({1: (S("A"), None), 2: (S("B"), None)}),
    "price_text_junk": one({1: (S("A"), S("abc")), 2: (S("B"), S(""))}),
    "price_error_cell": one({1: (S("A"), ("e", "#N/A")), 2: (S("B"), ("e", "#DIV/0!"))}),
    "price_inline_and_sst": raw_xlsx([("S", {1: (("sst", 0), ("sst", 1)), 2: (("sst", 2), N("5"))})], shared=["Шоколад", "7,25", "Цукор"]),
    "price_sst_empty": raw_xlsx([("S", {1: (("sst", 0), ("sst", 1))})], shared=["X", ""]),
    "formula_cached": one({1: (S("A"), ("fn", "1+1.5", "2.5")), 2: (S("B"), ("fn", "ROUND(0.1+0.2,2)", "0.3")), 3: (("fs", 'CONCATENATE("a","b")', "ab"), N("1"))}),
    "formula_no_cache": one({1: (S("A"), ("f", "1+1")), 2: (S("B"), N("2"))}),
    "date_price": one({1: (S("A"), N("45000", 1)), 2: (S("B"), N("45000.5", 2))}),
    "date_name": one({1: (N("45000", 1), N("5")), 2: (N("45000.75", 2), N("6"))}),
    "numfmt_not_date": one({1: (S("A"), N("45000", 3)), 2: (S("B"), N("2.5", 4))}),
    "name_numbers": one({1: (N("42"), N("1")), 2: (N("1"), N("2")), 3: (N("1.0"), N("3")), 4: (N("1e16"), N("4")), 5: (N("123456789012345678"), N("5")), 6: (N("0.00001"), N("6")), 7: (N("1.5"), N("7")), 8: (N("100000.0"), N("8")), 9: (N("-5"), N("9")), 10: (N("1E-05"), N("10")), 11: (N("12345678901234567.0"), N("11")), 12: (N("0.0001"), N("12"))}),
    "name_zero": one({1: (N("0"), N("1")), 2: (N("0.0"), N("2"))}),
    "name_true": one({1: (("b", "1"), N("1"))}),
    "name_bool": one({1: (("b", "1"), N("1")), 2: (("b", "0"), N("2"))}),
    "name_blank_string": one({1: (S("   "), N("1")), 2: (S(""), N("2"))}),
    "name_too_long": one({1: (S("я" * 101), N("1")), 2: (S("я" * 100), N("2"))}),
    "name_whitespace_inner": one({1: (S("  Сир \t  твердий  "), N("5")), 2: (S("Сир твердий"), N("6"))}),
    "dup_case_sensitive": one({1: (S("Сир"), N("1")), 2: (S("сир"), N("2")), 3: (S("СИР"), N("3"))}),
    "dup_existing_and_archived": one({1: (S("Хліб"), N("1")), 2: (S("Old  Stock"), N("2")), 3: (S("New"), N("3")), 4: (S("New"), N("4"))}),
    "all_duplicates": one({1: (S("Хліб"), N("1")), 2: (S("Old Stock"), N("2"))}),
    "row_gaps": one({3: (S("A"), N("1")), 7: (S("B"), S("bad")), 9: (S("C"), N("3"))}),
    "header_after_gap": one({2: (S("Name"), S("Price")), 3: (S("A"), N("1"))}),
    "many_bad_rows": one({i: (S(f"p{i}"), S("x")) for i in range(1, 26)}),
    "mixed_good_bad": one({1: (S("Good"), N("1")), 2: (S("Bad"), S("x")), 3: (S(""), N("1")), 4: (S("Good2"), N("2"))}),
    "active_second_sheet": raw_xlsx([("Перший", {1: (S("First"), N("1"))}), ("Другий", {1: (S("Second"), N("2"))})], active=1),
    "active_out_of_range": raw_xlsx([("Перший", {1: (S("First"), N("1"))})], active=5),
    "extra_columns_ignored": op_xlsx([["A", 1, "junk", 3], ["B", 2]]),
    "empty_sheet": raw_xlsx([("S", {})]),
    "only_header": op_xlsx([["Name", "Price"]]),
    "only_empty_rows": one({1: (None, None), 2: (None, None)}),
    "price_exp_giant": one({1: (S("A"), N("1e400"))}),
    "price_inf_text": one({1: (S("A"), S("Infinity")), 2: (S("B"), S("NaN"))}),
    "price_half_even": op_xlsx([["A", "0.125"], ["B", "0.135"], ["C", 0.005], ["D", 0.015]]),
    "unicode_names": op_xlsx([["Молоко «Ферма» 1л", 32.9], ["Їжак ґанок", 10], ["Ǆ ǅ", 1]]),
    "garbage_bytes": b"this is not a zip file",
    "zip_without_workbook": None,
}
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    z.writestr("hello.txt", "hi")
FIXTURES["zip_without_workbook"] = buf.getvalue()


def new_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(engine, expire_on_commit=False)
    with Session() as db:
        user = User(login="admin", password_hash="x")
        db.add(user)
        db.add(Product(name="Хліб", price_cents=120))
        db.add(Product(name="Old Stock", price_cents=5, archived=True, active=False))
        db.commit()
        db.refresh(user)
    return engine, Session, user


def run(payload):
    engine, Session, user = new_db()
    request = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers = {"host": "testserver"}
    request.session = {}
    with Session() as db:
        before = {p.id for p in db.scalars(select(Product))}
        res = {}
        try:
            res["status"] = 200
            res["message"] = parse_products_excel(payload, db, user.login, "Адміністратор", request)
        except HTTPException as e:
            res = {"status": e.status_code, "detail": e.detail}
        res["created"] = [[p.name, p.price_cents] for p in db.scalars(select(Product).order_by(Product.id)) if p.id not in before]
        res["audit"] = [[a.action, a.detail] for a in db.scalars(select(AuditLog).order_by(AuditLog.id))]
    engine.dispose()
    return res


# ---- export ---------------------------------------------------------------------------------------------


class _Store:
    def __init__(self, calc):
        self.calculation_enabled = calc


EXPORT_STATES = {
    "plain": {"calc": [False, False], "rows": [["Молоко, 1 л", 95, 3, 0, 285], ["Хліб", 120, 10, 0, 1200], ["Яблука, кг", 250, 4, 0, 1000]], "grand": 2485},
    "calculation": {"calc": [True, False], "rows": [["Сир", 10005, 2, 1, 20010], ["Хліб", 120, 0, 7, 0]], "grand": 20010},
    "empty": {"calc": [False], "rows": [], "grand": 0},
    "empty_calculation": {"calc": [True], "rows": [], "grand": 0},
    "no_stores": {"calc": [], "rows": [["Один", 1, 1, 0, 1]], "grand": 1},
    "big_money": {"calc": [False], "rows": [["Дорого", 1000000000, 2, 0, 2000000000], ["Копійки", 1, 1, 0, 1]], "grand": 2000000001},
}


def dump_workbook(data):
    wb = load_workbook(io.BytesIO(data))
    ws = wb.active
    cells, formats, bold = [], {}, []
    for row in ws.iter_rows():
        cells.append([c.value for c in row])
        for c in row:
            if c.number_format != "General":
                formats[c.coordinate] = c.number_format
            if c.font.bold:
                bold.append(c.coordinate)
    return {
        "sheets": wb.sheetnames,
        "cells": cells,
        "formats": formats,
        "bold": bold,
        "widths": {k: v.width for k, v in sorted(ws.column_dimensions.items())},
        "freeze": ws.freeze_panes,
        "autofilter": ws.auto_filter.ref,
        "max_row": ws.max_row,
        "max_col": ws.max_column,
    }


def export_golden():
    from unittest import mock

    from app.modules.reports import excel

    out = {}
    for name, st in EXPORT_STATES.items():
        stores = [_Store(c) for c in st["calc"]]
        rows = [{"name": n, "price": p, "qty": q, "calc_qty": c, "sum": s} for n, p, q, c, s in st["rows"]]
        with mock.patch.object(excel, "build_summary", return_value=(stores, rows, [], st["grand"])):
            data = excel.generate_summary_excel(None, "2026-11").getvalue()
        out[name] = {"state": st, "workbook": dump_workbook(data)}
    return out


def main():
    FIX.mkdir(exist_ok=True)
    (OUT / "xlsx_export.json").write_text(json.dumps(export_golden(), ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    golden = {}
    for name, payload in FIXTURES.items():
        (FIX / f"{name}.xlsx").write_bytes(payload)
        golden[name] = run(payload)
    (OUT / "xlsx_import.json").write_text(json.dumps(golden, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(golden)} import fixtures")


if __name__ == "__main__":
    main()
