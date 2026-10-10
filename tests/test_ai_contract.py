"""The generated contract must preserve the AI data clients receive over HTTP."""

import asyncio
import importlib.util
import json
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import httpx
import yaml

from connect import db, security
from connect.config import Settings
from shared.python import models

ROOT = Path(__file__).resolve().parent.parent


class AiContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        settings = Settings(db_path=str(Path(self.tmp.name) / "contract.db"),
                            master_key=b"k" * 32, demo_account=True)
        self.settings = settings
        # Isolate the service's import-time database and provider settings from local .env files.
        spec = importlib.util.spec_from_file_location("service._contract_test", ROOT / "service/service.py")
        self.service = importlib.util.module_from_spec(spec)
        with patch.object(Settings, "from_env", return_value=settings):
            spec.loader.exec_module(self.service)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.service.app),
                                       base_url="http://contract-test")
        self.spec = yaml.safe_load((ROOT / "openapi.yaml").read_text())

    async def asyncTearDown(self):
        await self.service.gateway.close()
        await self.service.backend.close()
        await self.client.aclose()
        self.tmp.cleanup()

    def validate_response(self, path, method, payload):
        self.assertIn(path, self.spec["paths"], f"Public operation {path} is missing from OpenAPI")
        schema = self.spec["paths"][path][method]["responses"]["200"]["content"]["application/json"]["schema"]
        if schema.get("type") == "array":
            model = getattr(models, schema["items"]["$ref"].rsplit("/", 1)[1])
            parsed = [model.model_validate(item).model_dump(mode="json", exclude_unset=True) for item in payload]
        else:
            model = getattr(models, schema["$ref"].rsplit("/", 1)[1])
            parsed = model.model_validate(payload).model_dump(mode="json", exclude_unset=True)
        self.assertEqual(parsed, payload, "Generated models must not silently discard response fields")

    async def test_state_roundtrip_preserves_pending_and_answered_ai_requests(self):
        self.service.gateway.set_internet_node("node0")
        rid = await self.service.gateway.ask("node0", "How fast is the Long Fast preset?")
        pending = (await self.client.get("/state")).json()
        self.assertIsNone(pending["ai"]["requests"][0]["answer"])
        self.validate_response("/state", "get", pending)
        await asyncio.gather(*self.service.gateway._tasks)
        answered = (await self.client.get("/state")).json()
        self.assertEqual(answered["ai"]["requests"][0]["request_id"], rid)
        self.assertEqual(answered["ai"]["requests"][0]["stage"], "answered")
        self.validate_response("/state", "get", answered)

    async def test_ai_control_and_catalog_responses_match_published_operations(self):
        gateway = await self.client.post("/ai/gateway", data={"node_id": "node0"})
        self.assertEqual(gateway.status_code, 200)
        self.validate_response("/ai/gateway", "post", gateway.json())
        ask = await self.client.post("/ai/ask", data={"src": "node0", "question": "How fast is Long Fast?"})
        self.assertEqual(ask.status_code, 200)
        self.validate_response("/ai/ask", "post", ask.json())
        await asyncio.gather(*self.service.gateway._tasks)
        catalog = await self.client.get("/connect/v1/models")
        self.assertEqual(catalog.status_code, 200)
        self.assertTrue(catalog.json())
        self.validate_response("/connect/v1/models", "get", catalog.json())
        disconnected = await self.client.post("/ai/gateway", data={"node_id": ""})
        self.assertIsNone(disconnected.json()["internet_node"])
        self.validate_response("/ai/gateway", "post", disconnected.json())

    async def test_connect_credentials_and_sealed_relay_roundtrip(self):
        asker, asker_key = self.service.gateway.devices["node0"]
        gateway, gateway_key = self.service.gateway.devices["node5"]
        with db.connect(self.settings.db_path) as connection:
            connection.execute("INSERT INTO setup_tokens VALUES(?,?,?,0)",
                               ("contract-setup", asker, time.time() + 60))
        exchange = await self.client.post("/connect/v1/exchange", json={"token": "contract-setup"})
        self.assertEqual(exchange.status_code, 200)
        self.validate_response("/connect/v1/exchange", "post", exchange.json())

        async def signed_post(path, payload):
            body, ts = json.dumps(payload).encode(), str(time.time())
            return await self.client.post(path, content=body, headers={
                "Content-Type": "application/json", "X-Device-Id": str(gateway), "X-Timestamp": ts,
                "X-Signature": security.sign(gateway_key, ts, body),
            })

        rid = str(uuid.uuid4())
        sealed = security.seal(asker_key, rid, asker, b"\x00How fast is Long Fast?")
        relay = await signed_post("/connect/v1/relay", {
            "request_id": rid, "device_id": asker, "sealed": security.b64e(sealed),
        })
        self.assertEqual(relay.status_code, 200)
        self.assertEqual(relay.json()["state"], "answered")
        self.validate_response("/connect/v1/relay", "post", relay.json())
        receipt = await signed_post("/connect/v1/receipt", {"request_id": rid})
        self.assertEqual(receipt.status_code, 200)
        self.validate_response("/connect/v1/receipt", "post", receipt.json())


if __name__ == "__main__":
    unittest.main()
