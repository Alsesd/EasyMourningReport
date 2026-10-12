"""Renders every page template with sample data (only needs jinja2), to catch template errors early."""
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace as NS

from jinja2 import Environment, FileSystemLoader

TEMPLATES = Path(__file__).resolve().parent.parent / "app" / "templates"
env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=True)
env.filters["money"] = lambda c: f"{c / 100:.2f}"


def render(name, path="/", **ctx):
    base = dict(request=NS(url=NS(path=path)), user=None, flash=None, this_period="2026-10", nav_period="2026-10")
    base.update(ctx)
    return env.get_template(name).render(**base)


ADMIN = NS(role="admin", store=None, login="admin")
STORE = NS(role="store", store=NS(name="Магазин 1"), login="store1")


class Templates(unittest.TestCase):
    def test_all_templates_compile(self):
        for f in TEMPLATES.glob("*.html"):
            env.get_template(f.name)

    def test_flash_and_tabs_keep_month(self):
        html = render("login.html", error=None, flash={"kind": "ok", "text": "Збережено <b>"})
        self.assertIn('class="flash ok"', html)
        self.assertIn("Збережено &lt;b&gt;", html)  # escaped
        html = render("logs.html", "/admin/logs", user=ADMIN, nav_period="2026-08", logs=[], actions=["вхід"], login="", action="")
        self.assertIn("/admin/reports?period=2026-08", html)
        self.assertIn("/admin/summary?period=2026-08", html)

    def test_store_report_two_price_lines(self):
        rows = [{"id": 1, "name": "Хліб", "repriced": True, "sum": 360,
                 "inputs": [{"price": 120, "qty": 3, "label": "old"}, {"price": 130, "qty": 0, "label": "new"}]},
                {"id": 2, "name": "Молоко", "repriced": False, "sum": 0, "inputs": [{"price": 95, "qty": 0, "label": ""}]}]
        html = render("report.html", "/report", user=STORE, period="2026-10", rows=rows, inactive_rows=[], inactive_total=0,
                      total=360, status="draft", min_period="2026-09", max_period="2026-10",
                      prev_period="2026-09", next_period=None)
        self.assertIn('name="qty_1_120"', html)
        self.assertIn('name="qty_1_130"', html)          # both lines exist even though nothing was saved at 1.30
        self.assertIn("стара ціна", html)
        self.assertIn("нова ціна", html)
        self.assertEqual(html.count('name="qty_2_'), 1)  # unchanged product: one line
        self.assertIn("Зберегти чернетку", html)
        self.assertIn("Надіслати звіт", html)
        self.assertIn("period=2026-09", html)            # previous-month link

    def test_store_report_locked_has_no_buttons(self):
        rows = [{"id": 1, "name": "Хліб", "repriced": False, "sum": 0, "inputs": [{"price": 120, "qty": 0, "label": ""}]}]
        html = render("report.html", "/report", user=STORE, period="2026-10", rows=rows, inactive_rows=[
            {"name": "Старий", "archived": True, "lines": "2 × 1.00", "sum": 200}], inactive_total=200,
            total=200, status="submitted", min_period="2026-10", max_period="2026-10", prev_period=None, next_period=None)
        self.assertNotIn('value="submit"', html)
        self.assertIn("Неактивні позиції (1)", html)
        self.assertIn(" disabled", html)

    def test_admin_settings(self):
        p = NS(id=7, name='Хліб "свіжий"', price_cents=130, active=True)
        archived = NS(id=8, name="Старий товар")
        s = NS(id=3, name="Магазин 1")
        html = render("admin.html", "/admin", user=ADMIN,
                      products=[{"p": p, "used": 4, "prev": 120, "change": (120, 130)}], inactive_products=[],
                      archived_products=[{"p": archived, "used": 2}],
                      stores=[{"store": s, "user": NS(login="store1"), "reports": 2}],
                      archived_stores=[{"store": NS(id=4, name="Закритий"), "user": NS(login="old"), "reports": 5}])
        self.assertIn('action="/admin/products/7"', html)
        self.assertIn('class="price-editor"', html)
        self.assertIn('aria-controls="price-editor-7"', html)
        self.assertIn('placeholder="0.00"', html)
        self.assertIn('class="save-product" hidden', html)
        self.assertIn('src="/static/admin.js" defer', html)
        self.assertIn('action="/admin/stores/3/edit"', html)
        self.assertIn("1.20 → 1.30", html)
        self.assertIn('id="product-search"', html)
        self.assertIn("Архів товарів", html)
        self.assertIn("Архів магазинів", html)
        self.assertIn("піде в архів", html)            # delete confirmation for a product that has data
        self.assertIn('action="/admin/products/8/restore"', html)
        self.assertIn('action="/admin/stores/4/restore"', html)
        self.assertIn("&#34;свіжий&#34;", html)         # quotes in names cannot break out of attributes

    def test_admin_settings_empty(self):
        html = render("admin.html", "/admin", user=ADMIN, products=[], inactive_products=[], archived_products=[], stores=[], archived_stores=[])
        self.assertIn("Активних товарів ще немає", html)
        self.assertIn("Неактивні товари (0)", html)
        self.assertIn('id="product-search"', html)
        self.assertNotIn('id="archive"', html)

    def test_admin_report_pages(self):
        store = NS(name="Магазин 1", archived=True)
        html = render("reports.html", "/admin/reports", user=ADMIN, period="2026-10", prev_period="2026-09",
                      next_period="2026-11", rows=[{"store": store, "report": NS(id=5, status="submitted"), "total": 1234},
                                                   {"store": NS(name="Б", archived=False), "report": None, "total": 0}])
        self.assertIn("Надіслано", html)
        self.assertIn("Немає звіту", html)
        self.assertIn("В архіві", html)
        html = render("report_view.html", "/admin/reports/5", user=ADMIN, period="2026-10",
                      report=NS(id=5, status="draft", period="2026-10", store=store),
                      lines=[{"name": "Хліб", "label": "new", "price": 130, "qty": 0, "sum": 0}],
                      inactive_rows=[], total=0)
        self.assertIn("нова ціна", html)
        self.assertIn("Заблокувати звіт", html)

    def test_summary_keeps_filter_in_month_links(self):
        html = render("summary.html", "/admin/summary", user=ADMIN, period="2026-10", prev_period="2026-09",
                      next_period="2026-11", stores=[NS(name="М1")], submitted_only=True, store_sums=[100], grand=100,
                      rows=[{"name": "Хліб", "note": "1.20 → 1.30", "cells": [3], "qty": 3, "sum": 100}])
        self.assertIn("period=2026-09&amp;submitted_only=1", html)
        self.assertIn("ціна: 1.20 → 1.30", html)
        self.assertIn("checked", html)

    def test_logs_and_error(self):
        log = NS(ts=datetime(2026, 10, 1, 12, 0), login="admin", role="admin", action="змінено ціну товару",
                 detail="Хліб · 1.20 → 1.30", ip="1.2.3.4")
        html = render("logs.html", "/admin/logs", user=ADMIN, logs=[log], actions=["вхід"], login="", action="")
        self.assertIn("змінено ціну товару", html)
        self.assertIn("Сторінку не знайдено", render("error.html", code=404, message="Not Found"))
        self.assertIn("Лише для адміністраторів", render("error.html", code=403, message="Лише для адміністраторів"))


if __name__ == "__main__":
    unittest.main()
