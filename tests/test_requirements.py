"""Acceptance coverage for windowed recovery, parity, video, and API contracts."""

import asyncio
import hashlib
import json
from pathlib import Path
import subprocess
import unittest
import uuid
from dataclasses import replace

from backend.media import (
    encode_image,
    encode_voice,
    encode_video,
    encode_text,
    pack_media,
)
from backend.mesh_backend import MeshBackend
from backend.packets import (
    Frame,
    DATA,
    PARITY,
    ACK,
    RECEIPT,
    QUERY,
    DATA_BYTES,
    WINDOW_SIZE,
    split_transfer,
    make_parity,
)
from backend.reassembly import Receiver

ASSETS = Path(__file__).resolve().parents[1] / "demo_assets"


class RecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def send(self, backend):
        data = bytes(range(256)) * 4
        mid = await backend.send_message("node0", "node5", data, "image")
        result = await backend.wait_message(mid)
        return mid, result, data

    async def test_parity_recovers_permanently_missing_data_chunk(self):
        b = MeshBackend(
            loss_rate=0,
            playback_speed=1e9,
            max_attempts=4,
            drop_predicate=lambda f, a, d: f.kind == DATA and f.index == 1,
        )
        mid, m, data = await self.send(b)
        self.assertEqual(m.status, "delivered", m.error)
        self.assertEqual(m.data_retries, 0)
        self.assertEqual(m.fec_recovered, 1)
        self.assertEqual(b.received_media[mid].data, data)

    async def test_two_losses_need_selective_retry_and_then_recover(self):
        dropped = set()

        def drop(f, a, d):
            if f.kind == DATA and f.index in (1, 2) and f.index not in dropped:
                dropped.add(f.index)
                return True
            return False

        # link_retries=0 isolates end-to-end selective retry from hop-level ARQ.
        b = MeshBackend(
            loss_rate=0, playback_speed=1e9, drop_predicate=drop, link_retries=0
        )
        mid, m, data = await self.send(b)
        self.assertEqual(m.status, "delivered")
        self.assertEqual(m.data_retries, 2)
        self.assertEqual(b.received_media[mid].data, data)

    async def test_lost_control_retries_query_not_media(self):
        dropped = False

        def drop(f, a, d):
            nonlocal dropped
            if f.kind == ACK and not dropped:
                dropped = True
                return True
            return False

        b = MeshBackend(
            loss_rate=0, playback_speed=1e9, drop_predicate=drop, link_retries=0
        )
        _, m, _ = await self.send(b)
        self.assertEqual(m.status, "delivered")
        self.assertEqual(m.data_retries, 0)
        self.assertGreater(m.control_retries, 0)

    async def test_disabling_parity_does_not_claim_repair(self):
        b = MeshBackend(
            loss_rate=0,
            use_fec=False,
            playback_speed=1e9,
            max_attempts=3,
            drop_predicate=lambda f, a, d: f.kind == DATA and f.index == 1,
        )
        _, m, _ = await self.send(b)
        self.assertEqual(m.status, "failed")
        self.assertEqual(m.fec_recovered, 0)

    async def test_receiver_out_of_order_and_duplicate_with_parity(self):
        media = encode_text("hello " + str(list(range(150))))
        chunks = split_transfer(pack_media(media))
        mid = str(uuid.uuid4())
        r = Receiver(len(chunks))
        for base in range(0, len(chunks), 4):
            indexes = list(range(base, min(base + 4, len(chunks))))
            parity = Frame(
                PARITY,
                mid,
                0,
                5,
                base,
                len(chunks),
                make_parity([chunks[i] for i in indexes]),
            )
            r.accept(parity)
            for i in reversed(indexes[1:]):
                frame = Frame(DATA, mid, 0, 5, i, len(chunks), chunks[i])
                r.accept(frame)
                r.accept(frame)
        self.assertEqual(r.media.data, media.data)
        self.assertGreater(len(r.recovered), 0)
        first = Frame(DATA, mid, 0, 5, 0, len(chunks), b"corrupt")
        with self.assertRaises(ValueError):
            r.accept(first)

    async def test_relay_outage_uses_alternate_three_hop_route(self):
        fired = False
        b = MeshBackend(loss_rate=0, playback_speed=1e9)

        def drop(f, a, d):
            nonlocal fired
            if f.kind == DATA and a == "node1" and not fired:
                fired = True
                b.set_node_online("node1", False)
            return False

        b.drop_predicate = drop
        mid, m, data = await self.send(b)
        self.assertEqual(m.status, "delivered", m.error)
        self.assertGreaterEqual(len(m.route_history), 2)
        self.assertNotIn("node1", m.route_history[-1])
        self.assertEqual(len(m.route_history[-1]) - 1, 3)
        self.assertEqual(b.received_media[mid].data, data)

    async def test_corrupt_receipt_never_delivered(self):
        class CorruptReceiptMesh(MeshBackend):
            async def _transmit(self, frame, msg):
                result = await super()._transmit(frame, msg)
                return (
                    replace(result, payload=b"x" * 32)
                    if result and result.kind == RECEIPT
                    else result
                )

        b = CorruptReceiptMesh(loss_rate=0, playback_speed=1e9)
        _, m, _ = await self.send(b)
        self.assertEqual(m.status, "failed")
        self.assertIn("digest mismatch", m.error)

    async def test_shared_channel_concurrent_media_and_frame_limits(self):
        b = MeshBackend(seed=3, playback_speed=1e9)
        mids = [
            await b.send_message("node0", "node5", bytes(range(256)) * 2, "image")
            for _ in range(3)
        ]
        messages = await asyncio.gather(*(b.wait_message(mid) for mid in mids))
        self.assertTrue(all(m.status == "delivered" for m in messages))
        self.assertAlmostEqual(
            sum(m.airtime_seconds for m in messages), b.simulation_time
        )
        times = [e["simulation_time"] for e in b.events]
        self.assertEqual(times, sorted(times))
        self.assertTrue(
            all(e["frame_bytes"] <= 230 for e in b.events if e["type"] == "packet_tx")
        )


class MediaAcceptanceTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.media = [
            encode_voice((ASSETS / "voice.wav").read_bytes()),
            encode_image((ASSETS / "camp.png").read_bytes()),
            encode_video((ASSETS / "camp.mp4").read_bytes()),
        ]

    async def test_all_demo_media_twenty_seeds_three_hops(self):
        for seed in range(20):
            b = MeshBackend(seed=seed, playback_speed=1e9)
            for media in self.media:
                mid = await b.send_message(
                    "node0",
                    "node5",
                    media.data,
                    media.metadata["media_type"],
                    metadata=media.metadata,
                )
                m = await b.wait_message(mid)
                self.assertEqual(
                    m.status,
                    "delivered",
                    f'{seed} {media.metadata["media_type"]}: {m.error}',
                )
                self.assertEqual(b.received_media[mid].data, media.data)
                self.assertEqual(len(m.route) - 1, 3)
                self.assertGreater(m.radio_bytes, len(media.data))

    async def test_video_is_playable_sparse_frames_with_budget(self):
        media = self.media[2]
        self.assertLessEqual(len(media.data), 12 * 1024)
        self.assertEqual(media.metadata["frames_per_second"], 1)
        self.assertFalse(media.metadata["audio_included"])
        self.assertLessEqual(media.metadata["duration_seconds"], 5)
        self.assertTrue(1 <= media.metadata["frame_count"] <= 5)
        # Decode the actual resulting MP4, not the source fixture.
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "null", "-"],
            input=media.data,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        with self.assertRaises(ValueError):
            encode_video(b"not a video")


class ContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import httpx
        from service import service

        self.service = service
        self.original = service.backend
        service.backend = MeshBackend(loss_rate=0, playback_speed=1e9)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=service.app), base_url="http://test"
        )

    async def asyncTearDown(self):
        await self.service.backend.close()
        await self.client.aclose()
        self.service.backend = self.original

    async def test_api_media_and_generated_state_contract(self):
        from shared.python.models import MeshState, SendVideoResponse

        for kind, name in [
            ("voice", "voice.wav"),
            ("image", "camp.png"),
            ("video", "camp.mp4"),
        ]:
            r = await self.client.post(
                "/send/" + kind,
                data={"src": "node0", "dst": "node5"},
                files={"file": (name, (ASSETS / name).read_bytes())},
            )
            self.assertEqual(r.status_code, 200, r.text)
            response = SendVideoResponse.model_validate(r.json())
            mid = response.msg_id
            await self.service.backend.wait_message(mid)
            content = await self.client.get(f"/messages/{mid}/content")
            self.assertEqual(content.status_code, 200)
            self.assertEqual(
                content.content, self.service.backend.received_media[mid].data
            )
        snapshot = (await self.client.get("/state")).json()
        MeshState.model_validate(snapshot)
        self.assertTrue(
            all(m["status"] == "delivered" for m in snapshot["messages"].values())
        )

    async def test_config_validation_and_reset(self):
        for payload in [
            {"loss_rate": 1.5},
            {"bit_rate": 0},
            {"playback_speed": 0},
            {"radio_range": -1},
        ]:
            r = await self.client.post("/simulation/config", json=payload)
            self.assertEqual(r.status_code, 422, r.text)
        r = await self.client.post(
            "/simulation/config",
            json={"loss_rate": 0.5, "playback_speed": 100, "use_fec": False},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["loss_rate"], 0.5)
        self.assertFalse(r.json()["fec"])
        r = await self.client.post("/simulation/reset")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["messages"], {})

    async def test_no_content_if_no_route(self):
        b = self.service.backend
        b.max_attempts = 2
        b.set_node_online("node1", False)
        b.set_node_online("node2", False)
        r = await self.client.post(
            "/send/text", data={"src": "node0", "dst": "node5", "text": "hello"}
        )
        mid = r.json()["msg_id"]
        await b.wait_message(mid)
        self.assertEqual(
            (await self.client.get(f"/messages/{mid}/content")).status_code, 409
        )
        self.assertEqual(b.messages[mid].status, "failed")
