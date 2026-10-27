"""Tests for FastAPI startup/shutdown and custom exception handlers."""

import asyncio
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("SECRET_KEY", "unit-test-only-secret-key")

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core import http_errors, lifecycle
from app.core.errors import FormError


def fake_request(method="GET", session=None, headers=None):
    request = MagicMock(spec=Request)
    request.method = method
    request.session = session if session is not None else {}
    request.headers = headers if headers is not None else {"host": "testserver"}
    request.url = MagicMock()
    request.url.path = "/test"
    return request


class ExceptionHandlerTests(unittest.TestCase):
    def test_form_error_prefers_explicit_target(self):
        request = fake_request(headers={"host": "testserver", "referer": "http://testserver/from"})
        response = http_errors.form_error(request, FormError("bad form", to="/target"))
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/target")

    def test_form_error_uses_safe_referer_then_home(self):
        request = fake_request(headers={"host": "testserver", "referer": "http://testserver/from?q=1"})
        response = http_errors.form_error(request, FormError("bad form"))
        self.assertEqual(response.headers["location"], "/from?q=1")

        request = fake_request(headers={"host": "testserver", "referer": "https://evil.example/"})
        response = http_errors.form_error(request, FormError("bad form"))
        self.assertEqual(response.headers["location"], "/")

    def test_post_validation_error_redirects_with_flash(self):
        request = fake_request("POST", headers={"host": "testserver", "referer": "http://testserver/form"})
        response = http_errors.invalid_form(request, RequestValidationError([]))
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/form")
        self.assertEqual(request.session["flash"]["kind"], "err")

    def test_get_validation_error_renders_400(self):
        request = fake_request("GET")
        response = http_errors.invalid_form(request, RequestValidationError([]))
        self.assertEqual(response.status_code, 400)

    def test_http_redirect_exception_preserves_location_and_status(self):
        request = fake_request()
        response = http_errors.http_error(
            request, StarletteHTTPException(status_code=307, headers={"Location": "/login"})
        )
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "/login")

    def test_http_error_without_redirect_renders_status(self):
        request = fake_request()
        response = http_errors.http_error(request, StarletteHTTPException(status_code=404, detail="missing"))
        self.assertEqual(response.status_code, 404)


class LifespanTests(unittest.TestCase):
    def test_lifespan_does_not_start_periodic_loop_when_sidecar_enabled(self):
        async def run():
            with patch.dict(os.environ, {"BACKUP_SIDECAR_ENABLED": "1"}), \
                 patch.object(lifecycle, "migrate") as migrate, \
                 patch.object(lifecycle, "seed") as seed, \
                 patch.object(lifecycle, "backup_loop") as backup_loop, \
                 patch.object(lifecycle.asyncio, "to_thread", new=AsyncMock(return_value=None)):
                async with lifecycle.lifespan(FastAPI()):
                    await asyncio.sleep(0)
                migrate.assert_called_once_with()
                seed.assert_called_once_with()
                backup_loop.assert_not_called()

        asyncio.run(run())

    def test_lifespan_initializes_and_cleans_up(self):
        async def wait_forever():
            await asyncio.Event().wait()

        async def run():
            with patch.object(lifecycle, "migrate") as migrate, \
                 patch.object(lifecycle, "seed") as seed, \
                 patch.object(lifecycle, "backup_db") as backup, \
                 patch.object(lifecycle, "backup_loop", side_effect=wait_forever), \
                 patch.object(lifecycle.asyncio, "to_thread", new=AsyncMock(return_value=None)) as to_thread:
                async with lifecycle.lifespan(FastAPI()):
                    await asyncio.sleep(0)
                migrate.assert_called_once_with()
                seed.assert_called_once_with()
                self.assertEqual(to_thread.await_count, 4)
                backup.assert_not_called()  # to_thread was mocked; it did not invoke the callable

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
