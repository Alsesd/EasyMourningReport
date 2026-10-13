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

    def test_store_report_uses_rest_and_alpine_client_rendering(self):
        html = render("report.html", "/report", user=STORE, period="2026-10")
        self.assertIn('x-data="storeReportApp(\'2026-10\')"', html)
        self.assertIn('x-for="row in rows"', html)
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
                      products=[{"p": p, "used": 4, "changes": [120, 130]}], inactive_products=[],
                      archived_products=[{"p": archived, "used": 2}],
                      stores=[{"store": s, "user": NS(login="store1"), "reports": 2}],
                      archived_stores=[{"store": NS(id=4, name="Закритий"), "user": NS(login="old"), "reports": 5}])
        self.assertIn('action="/admin/products/7"', html)
        self.assertIn('class="price-editor"', html)
        self.assertIn('aria-controls="price-editor-7"', html)
        self.assertIn('name="price" value="1.30"', html)
        self.assertIn('class="price-history-chip is-history"', html)
        self.assertIn('class="price-history-chip is-current"', html)
        self.assertNotIn('name="extra_price"', html)
        self.assertNotIn('class="price-options"', html)
        self.assertIn('class="primary save-product" hidden', html)
        self.assertIn('Додати товар</button>', html)  # create submit remains visible in the DOM
        self.assertIn('src="/static/admin.js" defer', html)
        self.assertIn('action="/admin/stores/3/edit"', html)
        self.assertIn("1.20 ₴", html)
        self.assertIn("1.30 ₴", html)
        self.assertIn('id="product-search"', html)
        self.assertIn('@submit.prevent="importProducts($event.currentTarget)"', html)
        self.assertIn('@submit.prevent="changeAdminPassword()"', html)
        self.assertIn("Змінити пароль", html)

    def test_admin_settings_shell_does_not_require_server_side_catalogue(self):
        html = render("admin.html", "/admin", user=ADMIN)
        self.assertIn('x-init="init()"', html)
        self.assertIn('x-show="loading"', html)
        self.assertIn('id="archive"', html)

    def test_admin_report_pages_use_rest_shells(self):
        html = render("reports.html", "/admin/reports", user=ADMIN, period="2026-10")
        self.assertIn('x-data="adminReportsApp(', html)
        self.assertIn('x-for="row in rows"', html)
        self.assertIn('src="/static/admin-reports-app.js"', html)
        html = render("report_view.html", "/admin/reports/5", user=ADMIN, report_id=5)
        self.assertIn('x-data="adminReportDetailApp(5)"', html)
        self.assertIn("Заблокувати звіт", html)

    def test_summary_uses_rest_and_keeps_excel_export(self):
        html = render("summary.html", "/admin/summary", user=ADMIN, period="2026-10", submitted_only=True)
        self.assertIn('x-data="adminSummaryApp(', html)
        self.assertIn("Лише надіслані", html)
        self.assertIn(':checked="submittedOnly"', html)
        self.assertIn('src="/static/admin-summary-app.js"', html)

    def test_logs_uses_rest_filters(self):
        html = render("logs.html", "/admin/logs", user=ADMIN)
        self.assertIn('x-data="adminLogsApp()"', html)
        self.assertIn("Журнал дій", html)
        self.assertIn('x-model="action"', html)

    def test_logs_and_error(self):
        log = NS(ts=datetime(2026, 10, 1, 12, 0), login="admin", role="admin", action="змінено ціну товару",
                 detail="Хліб · 1.20 → 1.30", ip="1.2.3.4")
        html = render("logs.html", "/admin/logs", user=ADMIN, logs=[log], actions=["вхід"], login="", action="")
        self.assertIn("змінено ціну товару", html)
        self.assertIn("Сторінку не знайдено", render("error.html", code=404, message="Not Found"))
        self.assertIn("Лише для адміністраторів", render("error.html", code=403, message="Лише для адміністраторів"))


if __name__ == "__main__":
    unittest.main()
