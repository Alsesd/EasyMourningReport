import os
import unittest

os.environ["SECRET_KEY"] = "unit-test-only-secret-key"

from fastapi import HTTPException

from app.core import dependencies
from app.core.errors import FormError
from app.core.periods import current_period, money


class CoreUiTests(unittest.TestCase):
    def test_money_formatting(self):
        self.assertEqual(money(100), "1.00")
        self.assertEqual(money(2550), "25.50")
        self.assertEqual(money(0), "0.00")

    def test_parse_period(self):
        self.assertEqual(dependencies.parse_period("2026-10"), "2026-10")
        self.assertEqual(dependencies.parse_period(None), current_period())
        with self.assertRaises(HTTPException):
            dependencies.parse_period("2026-13")
        with self.assertRaises(HTTPException):
            dependencies.parse_period("invalid")

    def test_to_cents(self):
        self.assertEqual(dependencies.to_cents("25.50"), 2550)
        self.assertEqual(dependencies.to_cents(" 25,50 "), 2550)
        self.assertEqual(dependencies.to_cents("100"), 10000)
        with self.assertRaises(FormError):
            dependencies.to_cents("abc")
        with self.assertRaises(FormError):
            dependencies.to_cents("-10")
        with self.assertRaises(FormError):
            dependencies.to_cents("NaN")
        with self.assertRaises(FormError):
            dependencies.to_cents("Infinity")
        with self.assertRaises(FormError):
            dependencies.to_cents("10000000.01")

    def test_clean_name(self):
        self.assertEqual(dependencies.clean_name("  Хліб  білий  "), "Хліб білий")
        with self.assertRaises(FormError):
            dependencies.clean_name("   ")
        with self.assertRaises(FormError):
            dependencies.clean_name("a" * 105)

    def test_clean_login(self):
        self.assertEqual(dependencies.clean_login("  Store1  "), "store1")
        with self.assertRaises(FormError):
            dependencies.clean_login("a")  # too short
        with self.assertRaises(FormError):
            dependencies.clean_login("store with spaces")

    def test_new_password(self):
        self.assertEqual(dependencies.new_password("secret123"), "secret123")
        with self.assertRaises(FormError):
            dependencies.new_password("12345")  # < 6 chars


if __name__ == "__main__":
    unittest.main()
