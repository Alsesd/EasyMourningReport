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

    def test_base_loads_page_components_before_alpine_runtime(self):
        html = render("base.html", "/admin", user=ADMIN)
        self.assertIn("alpine-load-failed", html)
        self.assertLess(html.index("/static/api-client.js"), html.index("/static/admin-app.js"))
        self.assertLess(html.index("/static/admin-app.js"), html.index("/static/alpine.min.js"))
        self.assertIn("https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js", html)

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

    def test_store_report_template_binds_locking_state_from_api(self):
        html = render("report.html", "/report", user=STORE, period="2026-10")
        self.assertIn('x-data="storeReportApp(\'2026-10\')"', html)
        self.assertIn(':disabled="report.read_only"', html)
        self.assertIn('x-show="!report.read_only"', html)
        self.assertIn('x-show="report.read_only"', html)
        self.assertIn("Неактивні позиції", html)

    def test_admin_settings_renders_product_editors_on_the_client(self):
        html = render("admin.html", "/admin", user=ADMIN)
        self.assertIn('x-data="adminApp()"', html)
        self.assertIn('x-init="init()"', html)
        self.assertIn('x-for="p in activeProducts"', html)
        self.assertIn('@submit.prevent="saveProduct(p)"', html)
        self.assertIn('x-model="p.editPrice"', html)
        self.assertIn(':id="\'price-editor-\' + p.id"', html)
        self.assertIn('x-for="(price, index) in p.month_prices_cents"', html)
        self.assertIn("'· зміна ' + index", html)
        self.assertNotIn('name="extra_price"', html)
        self.assertNotIn('class="price-options"', html)
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
        self.assertIn("/static/admin-reports-app.js", render("base.html", "/admin/reports", user=ADMIN))
        html = render("report_view.html", "/admin/reports/5", user=ADMIN, report_id=5)
        self.assertIn('x-data="adminReportDetailApp(5)"', html)
        self.assertIn("Заблокувати звіт", html)

    def test_summary_uses_rest_and_keeps_excel_export(self):
        html = render("summary.html", "/admin/summary", user=ADMIN, period="2026-10", submitted_only=True)
        self.assertIn('x-data="adminSummaryApp(', html)
        self.assertIn("Лише надіслані", html)
        self.assertIn(':checked="submittedOnly"', html)
        self.assertIn("/static/admin-summary-app.js", render("base.html", "/admin/summary", user=ADMIN))

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
