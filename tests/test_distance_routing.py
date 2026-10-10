import asyncio
import itertools
import unittest

from backend.mesh_backend import MeshBackend


class DistanceRoutingTests(unittest.TestCase):
    def backend(self, **kw):
        return MeshBackend(distance_routing=True, playback_speed=5000, **kw)

    def test_chosen_route_is_minimum_over_every_pair(self):
        b = self.backend()
        for src, dst in itertools.permutations(b.nodes, 2):
            route, proof = b._optimal_route(src, dst)
            self.assertTrue(route, (src, dst))
            costs = [b._path_cost(p) for p in b._all_paths(src, dst)]
            self.assertAlmostEqual(b._path_cost(route), min(costs), places=9)
            self.assertTrue(proof["optimal"])
            self.assertEqual(proof["chosen"], route)
            self.assertEqual(proof["candidates_checked"], len(costs))
            self.assertTrue(all(a["extra_cost"] >= 0 for a in proof["alternatives"]))

    def test_longer_links_lose_more_packets(self):
        b = self.backend()
        near = b._link_loss("node1", "node3")
        far = b._link_loss("node3", "node4")
        self.assertLess(near, far)
        self.assertEqual(MeshBackend(loss_rate=0.2)._link_loss("node3", "node4"), 0.2)

    def test_distance_can_beat_fewer_hops(self):
        b = self.backend(radio_range=300)
        b.nodes["node0"].x, b.nodes["node0"].y = 0, 0
        b.nodes["node5"].x, b.nodes["node5"].y = 290, 0
        b.nodes["node1"].x, b.nodes["node1"].y = 145, 0
        b._update_connections()
        route, _ = b._optimal_route("node0", "node5")
        self.assertEqual(route, ["node0", "node1", "node5"])
        self.assertIn("node5", b.connections["node0"])

    def test_message_carries_proof_and_delivers_on_chosen_route(self):
        async def run():
            b = self.backend()
            mid = await b.send_message("node0", "node5", b"hello over the mesh")
            await asyncio.wait_for(b._tasks[mid], 60)
            return b, mid

        b, mid = asyncio.run(run())
        m = b.messages[mid]
        self.assertEqual(m.status, "delivered")
        self.assertEqual(m.route, m.route_proof["chosen"])
        self.assertTrue(m.route_proof["optimal"])
        self.assertEqual(b.get_state()["messages"][mid]["route_proof"]["chosen"], m.route)

    def test_off_means_no_proof(self):
        b = MeshBackend()
        route, proof = b._route("node0", "node4"), None
        self.assertEqual(route, ["node0", "node2", "node4"])
        self.assertIsNone(proof)


if __name__ == "__main__":
    unittest.main()
