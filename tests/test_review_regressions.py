"""Regressions for the external review: image-sized messages over 4 lossy hops.

Reviewer scenario: a ~2.4 KB image from Alice to Frank across 4 hops at 20% loss
never arrived, and a stalled message showed "in transit" with a frozen ETA.
"""

import hashlib
import random
import unittest

from backend.packets import DATA
from backend.mesh_backend import MeshBackend

# A straight chain so the only route is Alice -> Bob -> Carol -> Dave -> Frank.
CHAIN = {
    "node0": (0, 0),
    "node1": (170, 0),
    "node2": (340, 0),
    "node3": (510, 0),
    "node4": (510, 170),  # Eve: reachable only from Dave, off the main path
    "node5": (680, 0),
}


def four_hop_mesh(**kwargs):
    backend = MeshBackend(playback_speed=1e9, **kwargs)
    for node_id, (x, y) in CHAIN.items():
        backend.nodes[node_id].x, backend.nodes[node_id].y = x, y
    backend._update_connections()
    assert len(backend._route("node0", "node5")) - 1 == 4
    return backend


def image_bytes(seed, size=2400):
    return random.Random(seed).randbytes(size)


class FourHopImageTests(unittest.IsolatedAsyncioTestCase):
    async def test_image_survives_20_percent_loss_over_4_hops(self):
        for seed in range(20):
            backend = four_hop_mesh(loss_rate=0.20, seed=seed)
            data = image_bytes(seed)
            mid = await backend.send_message("node0", "node5", data, "image")
            msg = await backend.wait_message(mid)
            self.assertEqual(msg.status, "delivered", f"seed {seed}: {msg.error}")
            self.assertGreaterEqual(msg.total_chunks, 12)
            received = backend.received_media[mid].data
            self.assertEqual(
                hashlib.sha256(received).digest(),
                hashlib.sha256(data).digest(),
                f"seed {seed}",
            )
            self.assertEqual(msg.route, ["node0", "node1", "node2", "node3", "node5"])
            await backend.close()

    async def test_status_never_claims_delivery_early(self):
        backend = four_hop_mesh(loss_rate=0.20, seed=11)
        seen = []

        def snapshot():
            for m in backend.get_state()["messages"].values():
                seen.append((m["status"], m["receiver_status"], m["acked"]))

        backend.on_state_change = snapshot
        mid = await backend.send_message("node0", "node5", image_bytes(11), "image")
        msg = await backend.wait_message(mid)
        self.assertEqual(msg.status, "delivered")
        for status, receiver_status, _ in seen:
            if status == "delivered":
                self.assertEqual(receiver_status, "verified")
        self.assertTrue(any(s in ("sending", "in_transit") for s, _, _ in seen))
        self.assertEqual(backend.get_state()["messages"][mid]["eta"], 0)

    async def test_stalled_message_ends_failed_without_eta(self):
        # Dave dies mid-transfer and never returns: there is no route to Frank.
        backend = four_hop_mesh(loss_rate=0.20, seed=3, max_attempts=6)
        killed = False

        def drop(frame, a, b):
            nonlocal killed
            if frame.kind == DATA and frame.index == 5 and not killed:
                killed = True
                backend.set_node_online("node3", False)
            return False

        backend.drop_predicate = drop
        mid = await backend.send_message("node0", "node5", image_bytes(3), "image")
        msg = await backend.wait_message(mid)
        state = backend.get_state()["messages"][mid]
        self.assertEqual(msg.status, "failed")
        self.assertIsNone(state["eta"])
        self.assertNotEqual(state["receiver_status"], "verified")
        self.assertLess(state["acked"], state["total_chunks"])
        self.assertTrue(state["error"])

    async def test_hop_retry_absorbs_single_link_loss(self):
        dropped = set()

        def drop(frame, a, b):
            if frame.kind == DATA and (frame.index, a) not in dropped:
                dropped.add((frame.index, a))
                return True  # first attempt on every link is lost
            return False

        backend = four_hop_mesh(loss_rate=0, drop_predicate=drop)
        data = image_bytes(1)
        mid = await backend.send_message("node0", "node5", data, "image")
        msg = await backend.wait_message(mid)
        self.assertEqual(msg.status, "delivered")
        self.assertEqual(msg.data_retries, 0)
        self.assertEqual(msg.link_retries, msg.total_chunks * 4)
        self.assertEqual(backend.received_media[mid].data, data)

    async def test_hop_retries_are_reproducible(self):
        runs = []
        for _ in range(2):
            backend = four_hop_mesh(loss_rate=0.20, seed=42)
            mid = await backend.send_message("node0", "node5", image_bytes(42), "image")
            msg = await backend.wait_message(mid)
            runs.append((msg.radio_bytes, msg.lost_packets, msg.link_retries))
        self.assertEqual(runs[0], runs[1])


if __name__ == "__main__":
    unittest.main()
