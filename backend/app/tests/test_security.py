import asyncio
import os
import unittest

os.environ["SECRET_KEY"] = "unit-test-only-secret-key"

from starlette.requests import Request
from starlette.responses import Response

from app.core.security import same_origin_post_guard


def request_with_headers(headers):
    return Request({
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "https",
        "path": "/admin/password",
        "raw_path": b"/admin/password",
        "query_string": b"",
        "headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()],
        "client": ("192.0.2.1", 12345),
        "server": ("example.com", 443),
    })


class SameOriginPostGuardTests(unittest.TestCase):
    def test_rejects_cross_origin_post(self):
        request = request_with_headers({"host": "example.com", "origin": "https://evil.example"})
        response = asyncio.run(same_origin_post_guard(request, lambda _: None))
        self.assertEqual(response.status_code, 403)

    def test_rejects_post_without_origin_or_referer(self):
        request = request_with_headers({"host": "example.com"})
        response = asyncio.run(same_origin_post_guard(request, lambda _: None))
        self.assertEqual(response.status_code, 403)

    def test_accepts_same_origin_referer(self):
        request = request_with_headers({"host": "example.com", "referer": "https://example.com/admin"})
        async def call_next(_):
            return Response("ok", status_code=204)

        response = asyncio.run(same_origin_post_guard(request, call_next))
        self.assertEqual(response.status_code, 204)


if __name__ == "__main__":
    unittest.main()
