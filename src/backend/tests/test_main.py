"""Tests for FastAPI startup/shutdown and JSON exception handlers."""

import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("SECRET_KEY", "unit-test-only-secret-key")

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

import app.main as main
from app.core.errors import DomainError


class ExceptionHandlerTests(unittest.TestCase):
    def test_domain_error_returns_json_validation_envelope(self):
        response = main.domain_error(None, DomainError("bad value"))
        self.assertEqual(response.status_code, 422)
        self.assertIn("application/json", response.headers["content-type"])
        self.assertEqual(
            response.body,
            b'{"detail":"bad value","code":"validation_error"}',
        )

    def test_request_validation_error_returns_json(self):
        response = main.invalid_request(None, RequestValidationError([]))
        self.assertEqual(response.status_code, 422)
        self.assertIn("application/json", response.headers["content-type"])

    def test_http_redirect_exception_preserves_location_and_status(self):
        request = Request({"type": "http", "method": "GET", "path": "/test", "headers": []})
        response = main.http_error(
            request, StarletteHTTPException(status_code=307, headers={"Location": "/login"})
        )
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "/login")

    def test_http_error_without_redirect_returns_json(self):
        request = Request({"type": "http", "method": "GET", "path": "/test", "headers": []})
        response = main.http_error(request, StarletteHTTPException(status_code=404, detail="missing"))
        self.assertEqual(response.status_code, 404)
        self.assertIn("application/json", response.headers["content-type"])


class LifespanTests(unittest.TestCase):
    def test_lifespan_initializes_and_cleans_up(self):
        async def wait_forever():
            await asyncio.Event().wait()

        async def run():
            with patch.object(main, "migrate") as migrate, \
                 patch.object(main, "seed") as seed, \
                 patch.object(main, "backup_db") as backup, \
                 patch.object(main, "backup_loop", side_effect=wait_forever), \
                 patch.object(main.asyncio, "to_thread", new=AsyncMock(return_value=None)) as to_thread:
                async with main.lifespan(FastAPI()):
                    await asyncio.sleep(0)
                migrate.assert_called_once_with()
                seed.assert_called_once_with()
                self.assertEqual(to_thread.await_count, 5)
                backup.assert_not_called()

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
