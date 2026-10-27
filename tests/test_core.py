import os
import unittest
from unittest.mock import MagicMock

os.environ["SECRET_KEY"] = "unit-test-only-secret-key"

from fastapi import HTTPException
from fastapi.requests import Request

from app.core import ui, validation
from app.features.auth import service as auth_service


class CoreUiTests(unittest.TestCase):
    def test_money_formatting(self):
        self.assertEqual(ui.money(100), "1.00")
        self.assertEqual(ui.money(2550), "25.50")
        self.assertEqual(ui.money(0), "0.00")

    def test_shift_period(self):
        self.assertEqual(ui.shift_period("2026-10", 1), "2026-11")
        self.assertEqual(ui.shift_period("2026-10", -1), "2026-09")
        self.assertEqual(ui.shift_period("2026-12", 1), "2027-01")
        self.assertEqual(ui.shift_period("2026-01", -1), "2025-12")

    def test_safe_redirect_target(self):
        self.assertEqual(ui._safe_redirect_target("/admin"), "/admin")
        self.assertEqual(ui._safe_redirect_target("https://evil.com"), "/")
        self.assertEqual(ui._safe_redirect_target("//evil.com"), "/")
        self.assertEqual(ui._safe_redirect_target(""), "/")
        self.assertEqual(ui._safe_redirect_target(None), "/")
        self.assertEqual(ui._safe_redirect_target("relative/path"), "/")
        self.assertEqual(ui._safe_redirect_target(r"\\\\evil.example"), "/")

    def test_safe_referer(self):
        req = MagicMock(spec=Request)
        req.headers = {"referer": "http://localhost:8000/report?period=2026-10", "host": "localhost:8000"}
        self.assertEqual(ui.safe_referer(req), "/report?period=2026-10")

        # Cross-origin referer
        req.headers = {"referer": "http://evil.com/phish", "host": "localhost:8000"}
        self.assertIsNone(ui.safe_referer(req))

        # Missing referer
        req.headers = {"host": "localhost:8000"}
        self.assertIsNone(ui.safe_referer(req))

        req.headers = {"referer": "/admin?period=2026-10", "host": "localhost:8000"}
        self.assertEqual(ui.safe_referer(req), "/admin?period=2026-10")

    def test_flash_and_done(self):
        req = MagicMock(spec=Request)
        req.session = {}
        ui.flash(req, "ok", "Готово")
        self.assertEqual(req.session["flash"], {"kind": "ok", "text": "Готово"})

        resp = ui.done(req, "/report", "Збережено")
        self.assertEqual(resp.status_code, 303)
        self.assertEqual(resp.headers["location"], "/report")
        self.assertEqual(req.session["flash"], {"kind": "ok", "text": "Збережено"})


    def test_render_consumes_flash_and_keeps_explicit_period_links(self):
        req = MagicMock(spec=Request)
        req.session = {"flash": {"kind": "ok", "text": "saved"}, "period": "2026-08"}
        response = ui.render(
            req,
            "error.html",
            {"code": 418, "message": "test", "period": "2026-10", "prev_period": "custom-prev"},
            status_code=418,
        )
        self.assertEqual(response.status_code, 418)
        self.assertNotIn("flash", req.session)
        self.assertEqual(response.context["flash"], {"kind": "ok", "text": "saved"})
        self.assertEqual(response.context["nav_period"], "2026-08")
        self.assertEqual(response.context["prev_period"], "custom-prev")

        empty = ui.render(req, "error.html", None)
        self.assertEqual(empty.status_code, 200)
        self.assertIsNone(empty.context["user"])


class CoreDependenciesTests(unittest.TestCase):
    def test_parse_period(self):
        self.assertEqual(validation.parse_period("2026-10"), "2026-10")
        self.assertEqual(validation.parse_period(None), ui.current_period())
        with self.assertRaises(HTTPException):
            validation.parse_period("2026-13")
        with self.assertRaises(HTTPException):
            validation.parse_period("invalid")

    def test_to_cents(self):
        self.assertEqual(validation.to_cents("25.50"), 2550)
        self.assertEqual(validation.to_cents(" 25,50 "), 2550)
        self.assertEqual(validation.to_cents("100"), 10000)
        with self.assertRaises(ui.FormError):
            validation.to_cents("abc")
        with self.assertRaises(ui.FormError):
            validation.to_cents("-10")
        with self.assertRaises(ui.FormError):
            validation.to_cents("NaN")
        with self.assertRaises(ui.FormError):
            validation.to_cents("Infinity")
        with self.assertRaises(ui.FormError):
            validation.to_cents("10000000.01")

    def test_clean_name(self):
        self.assertEqual(validation.clean_name("  Хліб  білий  "), "Хліб білий")
        with self.assertRaises(ui.FormError):
            validation.clean_name("   ")
        with self.assertRaises(ui.FormError):
            validation.clean_name("a" * 105)

    def test_clean_login(self):
        self.assertEqual(auth_service.clean_login("  Store1  "), "store1")
        with self.assertRaises(ui.FormError):
            auth_service.clean_login("a")  # too short
        with self.assertRaises(ui.FormError):
            auth_service.clean_login("store with spaces")

    def test_new_password(self):
        self.assertEqual(auth_service.new_password("secret123"), "secret123")
        with self.assertRaises(ui.FormError):
            auth_service.new_password("12345")  # < 6 chars


if __name__ == "__main__":
    unittest.main()
