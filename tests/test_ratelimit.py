import unittest
from unittest.mock import patch

from app.core import ratelimit


class LoginRateLimitTests(unittest.TestCase):
    def setUp(self):
        ratelimit._fails.clear()

    def tearDown(self):
        ratelimit._fails.clear()

    def test_pair_limit_blocks_after_five_failures(self):
        for _ in range(5):
            ratelimit.record_failure("192.0.2.1", "alice")
        self.assertGreater(ratelimit.retry_after("192.0.2.1", "alice"), 0)

    def test_different_ip_has_separate_pair_counter(self):
        for _ in range(5):
            ratelimit.record_failure("192.0.2.1", "alice")
        self.assertEqual(ratelimit.retry_after("192.0.2.2", "alice"), 0)

    def test_success_clears_pair_failures(self):
        for _ in range(5):
            ratelimit.record_failure("192.0.2.1", "alice")
        ratelimit.clear_failures("192.0.2.1", "alice")
        self.assertEqual(ratelimit.retry_after("192.0.2.1", "alice"), 0)

    def test_expired_failures_do_not_block(self):
        with patch.object(ratelimit.time, "time", return_value=1000):
            for _ in range(5):
                ratelimit.record_failure("192.0.2.1", "alice")
        with patch.object(ratelimit.time, "time", return_value=1000 + ratelimit.WINDOW + 1):
            self.assertEqual(ratelimit.retry_after("192.0.2.1", "alice"), 0)


if __name__ == "__main__":
    unittest.main()
