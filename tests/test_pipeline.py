import asyncio
import hashlib
import io
import random
import shutil
import struct
import subprocess
import unittest
import uuid
import wave
from PIL import Image
from backend.packets import Frame, DATA, ACK, RECEIPT, PAYLOAD_BYTES, split
from backend.media import (
    EncodedMedia,
    encode_text,
    encode_image,
    encode_voice,
    pack_media,
    unpack_media,
    render_media,
)
from backend.mesh_backend import MeshBackend


class PacketTests(unittest.TestCase):
    def test_frame_boundaries_crc(self):
        for size in (0, 1, PAYLOAD_BYTES):
            frame = Frame(DATA, str(uuid.uuid4()), 0, 5, 0, 1, b"x" * size)
            wire = frame.serialize()
            self.assertLessEqual(len(wire), 230)
            self.assertEqual(Frame.deserialize(wire), frame)
            with self.assertRaises(ValueError):
                Frame.deserialize(wire[:-1] + bytes([wire[-1] ^ 1]))
        with self.assertRaises(ValueError):
            Frame(
                DATA, str(uuid.uuid4()), 0, 5, 0, 1, b"x" * (PAYLOAD_BYTES + 1)
            ).serialize()

    def test_text_exact_and_size_aware(self):
        for text in ("", "Hi", "🌊 café " * 300):
            media = encode_text(text)
            self.assertLessEqual(len(media.data), len(text.encode()))
            self.assertEqual(
                render_media(unpack_media(pack_media(media))).decode(), text
            )
        self.assertEqual(encode_text("Hi").metadata["codec"], "utf8")

    def test_integrity_and_reordered_duplicates(self):
        media = encode_text("Bridge closed. Do not cross." * 100)
        wire = pack_media(media)
        parts = list(enumerate(split(wire)))
        random.Random(2).shuffle(parts)
        received = dict(parts + parts)
        self.assertEqual(
            unpack_media(b"".join(received[i] for i in range(len(received)))).data,
            media.data,
        )
        with self.assertRaises(ValueError):
            unpack_media(wire[:-1] + bytes([wire[-1] ^ 1]))

    def test_image_real_decode(self):
        image = Image.new("RGB", (800, 400), "blue")
        source = io.BytesIO()
        image.save(source, format="PNG")
        media = encode_image(source.getvalue())
        decoded = Image.open(io.BytesIO(media.data))
        self.assertEqual(decoded.size, (160, 80))
        self.assertEqual(decoded.format, "WEBP")

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_voice_is_decodable_not_truncated_bytes(self):
        source = io.BytesIO()
        with wave.open(source, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b"\x00\x00" * 16000 * 6)
        media = encode_voice(source.getvalue())
        from backend.media import render_media

        with wave.open(io.BytesIO(render_media(media))) as decoded:
            self.assertAlmostEqual(
                decoded.getnframes() / decoded.getframerate(), 5, delta=0.1
            )
        self.assertLess(len(media.data), len(source.getvalue()))
        with self.assertRaises(ValueError):
            encode_voice(b"not an audio file")


class MeshTests(unittest.IsolatedAsyncioTestCase):
    async def run_transfer(self, **kwargs):
        backend = MeshBackend(playback_speed=1e9, **kwargs)
        data = bytes(range(256)) * 4
        mid = await backend.send_message("node0", "node5", data, "image")
        message = await backend.wait_message(mid)
        return backend, mid, message, data

    async def test_twenty_seeds_loss_and_actual_reassembly(self):
        for seed in range(20):
            backend, mid, msg, data = await self.run_transfer(seed=seed)
            self.assertEqual(msg.status, "delivered", f"seed {seed}")
            self.assertEqual(backend.received_media[mid].data, data)
            self.assertGreaterEqual(len(msg.route) - 1, 3)
            self.assertTrue(
                all(
                    e["frame_bytes"] <= 230
                    for e in backend.events
                    if e["type"] == "packet_tx"
                )
            )
            self.assertGreater(msg.radio_bytes, len(data) * 3)
            self.assertEqual(backend.get_state()["messages"][mid]["progress"], 1)

    async def test_real_image_and_voice_over_lossy_mesh(self):
        import wave

        image = io.BytesIO()
        Image.new("RGB", (400, 200), "green").save(image, format="PNG")
        media_items = [encode_image(image.getvalue())]
        if shutil.which("ffmpeg"):
            audio = io.BytesIO()
            with wave.open(audio, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(b"\x00\x00" * 32000)
            media_items.append(encode_voice(audio.getvalue()))
        backend = MeshBackend(seed=7, playback_speed=1e9)
        for media in media_items:
            mid = await backend.send_message(
                "node0",
                "node5",
                media.data,
                media.metadata["media_type"],
                metadata=media.metadata,
            )
            msg = await backend.wait_message(mid)
            self.assertEqual(msg.status, "delivered", msg.error)
            self.assertEqual(backend.received_media[mid].data, media.data)
            self.assertEqual(
                backend.received_media[mid].metadata["codec"], media.metadata["codec"]
            )

    async def test_ai_request_response_roundtrip(self):
        import json
        from backend.media import encode_ai_message

        backend = MeshBackend(seed=7, playback_speed=1e9)
        request_id = str(uuid.uuid4())
        for source, destination, response in [
            ("node0", "node5", False),
            ("node5", "node0", True),
        ]:
            media = encode_ai_message(
                "Exact words 🌊 " * 80, request_id, is_response=response
            )
            mid = await backend.send_message(
                source,
                destination,
                media.data,
                media.metadata["media_type"],
                metadata=media.metadata,
            )
            msg = await backend.wait_message(mid)
            self.assertEqual(msg.status, "delivered")
            body = json.loads(render_media(backend.received_media[mid]))
            self.assertEqual(body["request_id"], request_id)
            self.assertEqual(body["text"], "Exact words 🌊 " * 80)

    async def test_zero_and_total_loss(self):
        backend, mid, msg, data = await self.run_transfer(loss_rate=0)
        self.assertEqual(msg.status, "delivered")
        backend, mid, msg, data = await self.run_transfer(loss_rate=1, max_attempts=3)
        self.assertEqual(msg.status, "failed")
        self.assertNotIn(mid, backend.received_media)

    async def test_final_receipt_loss_is_not_delivered(self):
        backend, mid, msg, data = await self.run_transfer(
            loss_rate=0,
            max_attempts=3,
            drop_predicate=lambda frame, a, b: frame.kind == RECEIPT,
        )
        self.assertEqual(msg.receiver_status, "verified")
        self.assertEqual(msg.status, "receipt_unconfirmed")
        self.assertLess(len(msg.acked_chunks), msg.total_chunks)
        self.assertEqual(backend.received_media[mid].data, data)

    async def test_lost_ack_recovers_duplicate(self):
        dropped = set()

        def drop(frame, a, b):
            if frame.kind == ACK and frame.index not in dropped:
                dropped.add(frame.index)
                return True
            return False

        # Hop-level ARQ would absorb a single lost ACK; isolate end-to-end recovery.
        backend, mid, msg, data = await self.run_transfer(
            loss_rate=0, drop_predicate=drop, link_retries=0
        )
        self.assertEqual(msg.status, "delivered")
        self.assertGreater(msg.retries, 0)
        self.assertEqual(backend.received_media[mid].data, data)

    async def test_seed_repeatability_and_airtime(self):
        one, _, a, _ = await self.run_transfer(seed=3)
        two, _, b, _ = await self.run_transfer(seed=3)
        self.assertEqual(
            (a.radio_bytes, a.lost_packets, a.retries),
            (b.radio_bytes, b.lost_packets, b.retries),
        )
        self.assertAlmostEqual(one.simulation_time, a.airtime_seconds)
        self.assertGreater(a.airtime_seconds, a.radio_bytes * 8 / one.bit_rate)

    async def test_outage_no_phantom_delivery(self):
        backend = MeshBackend(loss_rate=0, playback_speed=1e9, max_attempts=2)
        backend.set_node_online("node1", False)
        backend.set_node_online("node2", False)
        mid = await backend.send_message("node0", "node5", b"hello")
        msg = await backend.wait_message(mid)
        self.assertEqual(msg.status, "failed")
        self.assertEqual(msg.radio_bytes, 0)


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_endpoints_compress_and_serve_only_verified_receiver(self):
        import httpx
        from service import service

        backend = MeshBackend(loss_rate=0, playback_speed=1e9)
        original = service.backend
        service.backend = backend
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=service.app), base_url="http://test"
            ) as client:
                response = await client.post(
                    "/send/text",
                    data={"src": "node0", "dst": "node5", "text": "hello 🌊 " * 100},
                )
                self.assertEqual(response.status_code, 200)
                mid = response.json()["msg_id"]
                early = await client.get(f"/messages/{mid}/content")
                self.assertEqual(early.status_code, 409)
                await backend.wait_message(mid)
                content = await client.get(f"/messages/{mid}/content")
                self.assertEqual(content.text, "hello 🌊 " * 100)
                self.assertEqual(
                    response.json()["chunks"], backend.messages[mid].total_chunks
                )
                bad = await client.post(
                    "/send/voice",
                    data={"src": "node0", "dst": "node5"},
                    files={"file": ("bad.wav", b"bad")},
                )
                self.assertEqual(bad.status_code, 400)
        finally:
            await backend.close()
            service.backend = original


if __name__ == "__main__":
    unittest.main()
