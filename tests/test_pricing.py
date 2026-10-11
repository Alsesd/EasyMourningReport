import unittest

from app.pricing import (BASE_PERIOD, apply_price_change, dedupe_logins, latest_price, line_labels,
                         norm_login, offered_prices, same_name, valid_login)


class OfferedPrices(unittest.TestCase):
    def test_single_price_everywhere(self):
        h = [(BASE_PERIOD, 2500)]
        for period in ("2020-01", "2026-10", "2030-12"):
            self.assertEqual(offered_prices(h, period), [2500])

    def test_two_lines_only_in_change_month(self):
        h = [(BASE_PERIOD, 2500), ("2026-10", 2700)]
        self.assertEqual(offered_prices(h, "2026-09"), [2500])       # before: old price only
        self.assertEqual(offered_prices(h, "2026-10"), [2500, 2700])  # change month: old + new
        self.assertEqual(offered_prices(h, "2026-11"), [2700])       # later: new price only
        self.assertEqual(offered_prices(h, "2027-03"), [2700])

    def test_two_changes_in_different_months(self):
        h = [(BASE_PERIOD, 100), ("2026-10", 120), ("2026-12", 150)]
        self.assertEqual(offered_prices(h, "2026-10"), [100, 120])
        self.assertEqual(offered_prices(h, "2026-11"), [120])
        self.assertEqual(offered_prices(h, "2026-12"), [120, 150])
        self.assertEqual(offered_prices(h, "2027-01"), [150])

    def test_price_decrease_keeps_old_first(self):
        h = [(BASE_PERIOD, 300), ("2026-10", 200)]
        self.assertEqual(offered_prices(h, "2026-10"), [300, 200])

    def test_empty_history(self):
        self.assertEqual(offered_prices([], "2026-10"), [])


class ApplyPriceChange(unittest.TestCase):
    base = [(BASE_PERIOD, 2500)]

    def test_first_change(self):
        h, prev, now = apply_price_change(self.base, "2026-10", 2700)
        self.assertEqual(h, [(BASE_PERIOD, 2500), ("2026-10", 2700)])
        self.assertEqual((prev, now), (2500, 2700))

    def test_same_price_is_noop(self):
        h, prev, now = apply_price_change(self.base, "2026-10", 2500)
        self.assertEqual(h, self.base)
        self.assertEqual((prev, now), (2500, 2500))

    def test_second_change_same_month_replaces_first(self):
        h1, _, _ = apply_price_change(self.base, "2026-10", 2700)
        h2, prev, now = apply_price_change(h1, "2026-10", 2800)
        self.assertEqual(h2, [(BASE_PERIOD, 2500), ("2026-10", 2800)])
        self.assertEqual((prev, now), (2500, 2800))
        self.assertEqual(offered_prices(h2, "2026-10"), [2500, 2800])  # still two lines, never three

    def test_change_back_cancels(self):
        h1, _, _ = apply_price_change(self.base, "2026-10", 2700)
        h2, prev, now = apply_price_change(h1, "2026-10", 2500)
        self.assertEqual(h2, self.base)
        self.assertEqual(offered_prices(h2, "2026-10"), [2500])
        self.assertEqual((prev, now), (2500, 2500))

    def test_change_in_later_month_keeps_earlier_one(self):
        h1, _, _ = apply_price_change(self.base, "2026-10", 2700)
        h2, prev, now = apply_price_change(h1, "2026-11", 3000)
        self.assertEqual(h2, [(BASE_PERIOD, 2500), ("2026-10", 2700), ("2026-11", 3000)])
        self.assertEqual((prev, now), (2700, 3000))
        self.assertEqual(offered_prices(h2, "2026-10"), [2500, 2700])
        self.assertEqual(offered_prices(h2, "2026-11"), [2700, 3000])
        self.assertEqual(latest_price(h2), 3000)

    def test_no_price_before_period_raises(self):
        with self.assertRaises(ValueError):
            apply_price_change([("2026-10", 100)], "2026-09", 200)


class Lines(unittest.TestCase):
    def test_labels(self):
        self.assertEqual(line_labels([2500, 2700], []), [(2500, "old"), (2700, "new")])
        self.assertEqual(line_labels([2700], []), [(2700, "")])

    def test_saved_extra_prices_are_kept(self):
        self.assertEqual(line_labels([2500, 2800], [2700, 2500]), [(2500, "old"), (2800, "new"), (2700, "saved")])


class Logins(unittest.TestCase):
    def test_normalisation(self):
        self.assertEqual(norm_login("  Store1 "), "store1")
        self.assertEqual(norm_login("МАГАЗИН"), "магазин")

    def test_valid(self):
        self.assertTrue(valid_login("store1"))
        self.assertFalse(valid_login("a"))
        self.assertFalse(valid_login("has space"))
        self.assertFalse(valid_login(""))

    def test_same_name_ignores_case_and_spaces(self):
        self.assertTrue(same_name("Магазин  1", "магазин 1 "))
        self.assertFalse(same_name("Магазин 1", "Магазин 2"))

    def test_dedupe_for_migration(self):
        out = dedupe_logins([(1, "admin"), (2, "Store1"), (3, "store1"), (4, " STORE1 ")])
        self.assertEqual(out[1], "admin")
        self.assertEqual(out[2], "store1")
        self.assertEqual(len(set(out.values())), 4)  # all unique after migration


if __name__ == "__main__":
    unittest.main()
