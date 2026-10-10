import asyncio
import os
import sys
import types
import unittest
from unittest.mock import patch

from deployment.teamwater_origin import ProtectOrigin, create_app


TEST_TOKEN = "test-only-origin-token"


class ProtectOriginTests(unittest.IsolatedAsyncioTestCase):
    async def invoke(self, scope, messages=None):
        forwarded = []
        sent = []
        incoming = list(messages or ([{"type": "websocket.connect"}] if scope["type"] == "websocket" else [{"type": "http.request", "body": b""}]))

        async def receive():
            return incoming.pop(0)

        async def send(message):
            sent.append(message)

        async def backend(inner_scope, inner_receive, inner_send):
            forwarded.append(inner_scope)
            if inner_scope["type"] == "http":
                body = await inner_receive()
                await inner_send({"type": "http.response.start", "status": 201, "headers": []})
                await inner_send({"type": "http.response.body", "body": body["body"]})
            elif inner_scope["type"] == "websocket":
                self.assertEqual(await inner_receive(), {"type": "websocket.connect"})
                await inner_send({"type": "websocket.accept"})
                await inner_send({"type": "websocket.send", "text": "actual backend event"})
            elif inner_scope["type"] == "lifespan":
                for event in ("startup", "shutdown"):
                    self.assertEqual(await inner_receive(), {"type": f"lifespan.{event}"})
                    await inner_send({"type": f"lifespan.{event}.complete"})

        await ProtectOrigin(backend, TEST_TOKEN)(scope, receive, send)
        return forwarded, sent

    async def test_missing_or_wrong_token_rejects_every_http_method_before_backend(self):
        for headers in ([], [(b"x-teamwater-origin", b"wrong")]):
            for method in ("GET", "POST", "OPTIONS"):
                with self.subTest(headers=headers, method=method):
                    forwarded, sent = await self.invoke({"type": "http", "method": method, "path": "/health", "headers": headers})
                    self.assertEqual(forwarded, [])
                    self.assertEqual(sent[0]["status"], 403)
                    self.assertEqual(sent[1]["body"], b'{"detail":"Forbidden"}')
                    self.assertIn((b"content-type", b"application/json"), sent[0]["headers"])

    async def test_correct_token_passes_original_http_scope_and_request_body(self):
        scope = {"type": "http", "method": "POST", "path": "/send/voice", "headers": [(b"X-TeamWater-Origin", TEST_TOKEN.encode())]}
        forwarded, sent = await self.invoke(scope, [{"type": "http.request", "body": b"binary\x00voice", "more_body": False}])
        self.assertIs(forwarded[0], scope)
        self.assertEqual(sent[0]["status"], 201)
        self.assertEqual(sent[1]["body"], b"binary\x00voice")

    async def test_missing_or_wrong_token_closes_websocket_before_accept(self):
        for headers in ([], [(b"x-teamwater-origin", b"wrong")]):
            with self.subTest(headers=headers):
                forwarded, sent = await self.invoke({"type": "websocket", "path": "/ws", "headers": headers})
                self.assertEqual(forwarded, [])
                self.assertEqual(sent, [{"type": "websocket.close", "code": 1008}])

    async def test_correct_token_passes_websocket_to_backend(self):
        scope = {"type": "websocket", "path": "/ws", "headers": [(b"x-teamwater-origin", TEST_TOKEN.encode())]}
        forwarded, sent = await self.invoke(scope, [{"type": "websocket.connect"}])
        self.assertIs(forwarded[0], scope)
        self.assertEqual(sent, [{"type": "websocket.accept"}, {"type": "websocket.send", "text": "actual backend event"}])

    async def test_duplicate_origin_headers_are_rejected(self):
        for kind in ("http", "websocket"):
            with self.subTest(kind=kind):
                forwarded, sent = await self.invoke({"type": kind, "headers": [(b"x-teamwater-origin", TEST_TOKEN.encode()), (b"x-teamwater-origin", TEST_TOKEN.encode())]})
                self.assertEqual(forwarded, [])
                self.assertEqual(sent[0].get("status", sent[0].get("code")), 403 if kind == "http" else 1008)

    async def test_lifespan_passes_through_without_a_header(self):
        scope = {"type": "lifespan"}
        forwarded, sent = await self.invoke(scope, [{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}])
        self.assertIs(forwarded[0], scope)
        self.assertEqual(sent, [{"type": "lifespan.startup.complete"}, {"type": "lifespan.shutdown.complete"}])


class OriginFactoryTests(unittest.TestCase):
    def test_guard_cannot_be_constructed_with_an_empty_token(self):
        for token in (None, "", "   "):
            with self.subTest(token=token), self.assertRaises(ValueError):
                ProtectOrigin(lambda scope, receive, send: None, token)

    def test_missing_or_blank_token_fails_before_importing_backend(self):
        for values in ({}, {"TEAMWATER_ORIGIN_TOKEN": ""}, {"TEAMWATER_ORIGIN_TOKEN": "   "}):
            with self.subTest(values=values), patch.dict(os.environ, values, clear=True):
                with self.assertRaisesRegex(RuntimeError, "TEAMWATER_ORIGIN_TOKEN"):
                    create_app()

    def test_factory_wraps_the_actual_imported_backend_when_token_exists(self):
        backend = types.ModuleType("service.service")
        service = types.ModuleType("service")
        service.__path__ = []

        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 204, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        backend.app = app
        with patch.dict(sys.modules, {"service": service, "service.service": backend}), patch.dict(os.environ, {"TEAMWATER_ORIGIN_TOKEN": TEST_TOKEN}, clear=True):
            guarded = create_app()
        self.assertTrue(callable(guarded), "factory must return the guarded ASGI backend")
        sent = []

        async def send(message):
            sent.append(message)

        async def receive():
            return {"type": "http.request", "body": b""}

        asyncio.run(guarded({"type": "http", "headers": [(b"x-teamwater-origin", TEST_TOKEN.encode())]}, receive, send))
        self.assertEqual(sent[0]["status"], 204)


if __name__ == "__main__":
    unittest.main()
