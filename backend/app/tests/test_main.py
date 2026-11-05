"""Error handlers and the application lifespan."""

import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("SECRET_KEY", "unit-test-only-secret-key")

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import lifecycle
from app.core import http_errors
from app.core.errors import FormError


def request_for(path: str) -> Request:
    request = MagicMock(spec=Request)
    request.url.path = path
    return request


class ErrorHandlerTests(unittest.TestCase):
    def test_form_error_is_json_422(self):
        response = http_errors.form_error(request_for("/api/v1/users"), FormError("bad login"))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(json.loads(response.body), {"detail": "bad login", "code": "validation_error"})

    def test_validation_error_is_json_for_api_and_a_page_otherwise(self):
        exc = RequestValidationError([{"loc": ("body", "name"), "msg": "required", "type": "missing"}])
        api = http_errors.invalid_request(request_for("/api/v1/users"), exc)
        self.assertEqual(api.status_code, 422)
        self.assertEqual(json.loads(api.body)["errors"][0]["loc"], ["body", "name"])
        page = http_errors.invalid_request(request_for("/static/x"), exc)
        self.assertEqual(page.status_code, 400)
        self.assertIn("text/html", page.media_type)

    def test_http_error_escapes_message_on_pages(self):
        page = http_errors.http_error(request_for("/static/x"), StarletteHTTPException(404, "<b>Not Found</b>"))
        self.assertEqual(page.status_code, 404)
        self.assertIn(b"&lt;b&gt;Not Found&lt;/b&gt;", page.body)
        api = http_errors.http_error(request_for("/api/v1/x"), StarletteHTTPException(404, "Not Found"))
        self.assertEqual(json.loads(api.body), {"detail": "Not Found"})


class LifespanTests(unittest.TestCase):
    def test_lifespan_initializes_runs_backups_and_cleans_up(self):
        async def wait_forever():
            await asyncio.Event().wait()

        async def scenario():
            with patch.object(lifecycle, "migrate") as migrate, \
                 patch.object(lifecycle, "seed") as seed, \
                 patch.object(lifecycle, "backup_loop", side_effect=wait_forever) as loop, \
                 patch.object(lifecycle.asyncio, "to_thread", new=AsyncMock(return_value="ok")) as to_thread:
                async with lifecycle.lifespan(FastAPI()):
                    migrate.assert_called_once_with()
                    seed.assert_called_once_with()
                    loop.assert_called_once_with()
            called = [call.args[0] for call in to_thread.await_args_list]
            self.assertEqual(called[0], lifecycle.integrity_check)
            self.assertIn(lifecycle.tunnel.start_if_enabled, called)
            self.assertEqual(called[-3:], [lifecycle.tunnel.shutdown, lifecycle.checkpoint, lifecycle.backup_db])

        asyncio.run(scenario())

    def test_failed_integrity_check_is_logged_but_app_still_starts(self):
        async def scenario():
            with patch.object(lifecycle, "migrate"), patch.object(lifecycle, "seed"), \
                 patch.object(lifecycle, "backup_loop", new=AsyncMock()), \
                 patch.object(lifecycle.asyncio, "to_thread", new=AsyncMock(return_value="*** page 3 corrupt")), \
                 self.assertLogs("app", level="ERROR") as logs:
                async with lifecycle.lifespan(FastAPI()):
                    pass
            self.assertIn("page 3 corrupt", logs.output[0])

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
