import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from mesh_backend import MeshBackend

from connect import models
from connect.app import create_app
from connect.config import Settings
from service import ai_gateway
from service.ai_gateway import AiGateway


class CountingProvider:
    name = "counting"

    def __init__(self):
        self.calls = []

    def complete(self, model, system, user):
        self.calls.append(model)
        return "Long Fast sends about 1.07 kbps, about 1.7 seconds per packet per hop."


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.settings = Settings(db_path=str(Path(self.tmp.name) / "g.db"), master_key=b"k" * 32, demo_account=True)
        self.provider = CountingProvider()
        self.connect = create_app(self.settings, self.provider)
        self.backend = MeshBackend(loss_rate=0.2, seed=7, playback_speed=2000)
        self.gw = AiGateway(lambda: self.backend, self.connect, self.connect.state.demo["devices"], lambda: None,
                            internet_node="node5")

    async def asyncTearDown(self):
        await self.gw.close()
        await self.backend.close()
        self.tmp.cleanup()

    async def finish(self, rid, timeout=60):
        for _ in range(int(timeout * 20)):
            if self.gw.requests[rid]["stage"] in ("answered", "failed"):
                await asyncio.gather(*self.gw._tasks, return_exceptions=True)  # receipt step
                return self.gw.requests[rid]
            await asyncio.sleep(0.05)
        self.fail(f"request stuck at {self.gw.requests[rid]['stage']}")

    async def test_question_crosses_mesh_to_internet_node_and_answer_comes_back(self):
        rid = await self.gw.ask("node0", "How fast is the Long Fast preset?", 2)
        rec = await self.finish(rid)
        self.assertEqual(rec["stage"], "answered", rec)
        self.assertEqual(rec["outcome"], "ok")
        self.assertIn("1.07", rec["answer"])
        self.assertTrue(rec["sources"])  # source ids travelled over the radio
        self.assertEqual(rec["gateway"], "node5")
        self.assertTrue(rec["receipt"])
        self.assertEqual(self.provider.calls, [models.MODELS[2]["id"]])  # chosen by 1-byte index
        stages = [s["stage"] for s in rec["stages"]]
        self.assertEqual(stages[-4:], ["to_gateway", "ai_working", "answer_arriving", "answered"])
        req, ans = self.backend.messages[rec["request_msg_ids"][-1]], self.backend.messages[rec["answer_msg_ids"][-1]]
        self.assertEqual((req.src, req.dst, req.media_type), ("node0", "node5", "ai_request"))
        self.assertEqual((ans.src, ans.dst, ans.media_type), ("node5", "node0", "ai_response"))

    async def test_question_is_sealed_on_the_radio(self):
        rid = await self.gw.ask("node0", "How fast is the Long Fast preset?")
        rec = await self.finish(rid)
        on_air = self.backend.received_media[rec["request_msg_ids"][-1]].data
        self.assertNotIn(b"Long Fast", on_air)

    async def test_asker_with_internet_skips_the_mesh(self):
        self.gw.set_internet_node("node0")
        rec = await self.finish(await self.gw.ask("node0", "How fast is the Long Fast preset?"))
        self.assertEqual(rec["stage"], "answered")
        self.assertEqual(rec["request_msg_ids"], [])

    async def test_no_internet_node_waits_then_fails_without_calling_ai(self):
        ai_gateway.GATEWAY_WAIT_SECONDS = 1
        try:
            self.gw.set_internet_node(None)
            rec = await self.finish(await self.gw.ask("node0", "How fast is the Long Fast preset?"))
        finally:
            ai_gateway.GATEWAY_WAIT_SECONDS = 90
        self.assertEqual(rec["stage"], "failed")
        self.assertIn("waiting_for_gateway", [s["stage"] for s in rec["stages"]])
        self.assertEqual(self.provider.calls, [])

    async def test_lost_answer_is_redelivered_without_second_ai_call(self):
        dropped = {"n": 0}

        def drop_first_answer(frame, a, b):
            msg = self.backend.messages.get(frame.message_id)
            if msg and msg.media_type == "ai_response" and not self.gw.requests[rid]["answer_msg_ids"][1:]:
                dropped["n"] += 1
                return True
            return False

        self.backend.drop_predicate = drop_first_answer
        self.backend.max_attempts = 2
        rid = await self.gw.ask("node0", "How fast is the Long Fast preset?")
        rec = await self.finish(rid, timeout=120)
        self.assertGreater(dropped["n"], 0)
        self.assertEqual(rec["stage"], "answered", rec)
        self.assertEqual(len(rec["answer_msg_ids"]), 2)
        self.assertEqual(len(self.provider.calls), 1)

    async def test_ungrounded_question_says_i_dont_know_on_the_phone(self):
        rec = await self.finish(await self.gw.ask("node0", "Who won the 1998 world cup?"))
        self.assertEqual((rec["stage"], rec["outcome"]), ("answered", "no_grounding"))
        self.assertIn("don't know", rec["answer"])
        self.assertEqual(self.provider.calls, [])


if __name__ == "__main__":
    unittest.main()
