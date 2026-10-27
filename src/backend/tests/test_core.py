import os
import unittest

os.environ["SECRET_KEY"] = "unit-test-only-secret-key"

from fastapi import HTTPException

from app.core import formatting, periods, validation
from app.core.errors import DomainError
from app.features.auth import service as auth_service


class CoreFormattingTests(unittest.TestCase):
    def test_money_formatting(self):
        self.assertEqual(formatting.money(100), "1.00")
        self.assertEqual(formatting.money(2550), "25.50")
        self.assertEqual(formatting.money(0), "0.00")

    def test_shift_period(self):
        self.assertEqual(periods.shift_period("2026-10", 1), "2026-11")
        self.assertEqual(periods.shift_period("2026-10", -1), "2026-09")
        self.assertEqual(periods.shift_period("2026-12", 1), "2027-01")
        self.assertEqual(periods.shift_period("2026-01", -1), "2025-12")


class CoreDependenciesTests(unittest.TestCase):
    def test_parse_period(self):
        self.assertEqual(validation.parse_period("2026-10"), "2026-10")
        self.assertEqual(validation.parse_period(None), periods.current_period())
        with self.assertRaises(HTTPException):
            validation.parse_period("2026-13")
        with self.assertRaises(HTTPException):
            validation.parse_period("invalid")

    def test_to_cents(self):
        self.assertEqual(validation.to_cents("25.50"), 2550)
        self.assertEqual(validation.to_cents(" 25,50 "), 2550)
        self.assertEqual(validation.to_cents("100"), 10000)
        with self.assertRaises(DomainError):
            validation.to_cents("abc")
        with self.assertRaises(DomainError):
            validation.to_cents("-10")
        with self.assertRaises(DomainError):
            validation.to_cents("NaN")
        with self.assertRaises(DomainError):
            validation.to_cents("Infinity")
        with self.assertRaises(DomainError):
            validation.to_cents("10000000.01")

    def test_clean_name(self):
        self.assertEqual(validation.clean_name("  Хліб  білий  "), "Хліб білий")
        with self.assertRaises(DomainError):
            validation.clean_name("   ")
        with self.assertRaises(DomainError):
            validation.clean_name("a" * 105)

    def test_clean_login(self):
        self.assertEqual(auth_service.clean_login("  Store1  "), "store1")
        with self.assertRaises(DomainError):
            auth_service.clean_login("a")
        with self.assertRaises(DomainError):
            auth_service.clean_login("store with spaces")

    def test_new_password(self):
        self.assertEqual(auth_service.new_password("secret123"), "secret123")
        with self.assertRaises(DomainError):
            auth_service.new_password("12345")


if __name__ == "__main__":
    unittest.main()
