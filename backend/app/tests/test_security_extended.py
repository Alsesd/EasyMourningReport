"""Additional tests for secrets, password checks and client address handling."""

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from starlette.requests import Request
from starlette.responses import Response

from app.core import security


def make_request(method="GET", headers=None, client_host="192.0.2.10"):
    return Request({
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (client_host, 1234),
        "server": ("testserver", 80),
    })


class SecurityHelpersTests(unittest.TestCase):
    def test_password_hash_with_and_without_supplied_salt(self):
        salt = bytes(range(16))
        hashed = security.hash_pw("secret", salt)
        self.assertEqual(hashed.split("$")[0], salt.hex())
        self.assertTrue(security.check_pw("secret", hashed))
        self.assertFalse(security.check_pw("wrong", hashed))
        self.assertTrue(security.check_pw("auto-salt", security.hash_pw("auto-salt")))

    def test_load_secret_environment_override_and_persistent_file(self):
        with patch.dict(os.environ, {"SECRET_KEY": "environment-secret"}):
            self.assertEqual(security.load_secret(), "environment-secret")
        with tempfile.TemporaryDirectory() as tmp, \
             patch.dict(os.environ, {}, clear=True), \
             patch.object(security, "data_dir", return_value=Path(tmp)):
            first = security.load_secret()
            path = Path(tmp) / "secret.key"
            self.assertTrue(path.is_file())
            self.assertEqual(path.read_text(), first)
            self.assertEqual(security.load_secret(), first)
            self.assertEqual(len(first), 64)

    def test_client_ip_prefers_forwarded_ip_only_for_loopback(self):
        request = make_request(headers={"x-forwarded-for": "203.0.113.7, 10.0.0.2"}, client_host="127.0.0.1")
        self.assertEqual(security.client_ip(request), "203.0.113.7")
        self.assertEqual(security.client_ip(make_request(client_host="127.0.0.1")), "127.0.0.1")
        request = make_request(headers={"x-forwarded-for": "203.0.113.7"}, client_host="198.51.100.3")
        self.assertEqual(security.client_ip(request), "198.51.100.3")

    def test_missing_client_returns_placeholder(self):
        request = make_request()
        request.scope["client"] = None
        self.assertEqual(security.client_ip(request), "?")

    def test_non_post_request_bypasses_origin_check(self):
        request = make_request(method="GET", headers={"host": "testserver"})
        async def call_next(_):
            return Response("ok", status_code=200)
        response = asyncio.run(security.same_origin_post_guard(request, call_next))
        self.assertEqual(response.status_code, 200)

    def test_invalid_origin_scheme_is_rejected(self):
        request = make_request(method="POST", headers={"host": "testserver", "origin": "javascript:alert(1)"})
        response = asyncio.run(security.same_origin_post_guard(request, lambda _: None))
        self.assertEqual(response.status_code, 403)

    def test_origin_with_no_netloc_is_rejected(self):
        request = make_request(method="POST", headers={"host": "testserver", "origin": "https:/missing-host"})
        response = asyncio.run(security.same_origin_post_guard(request, lambda _: None))
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
