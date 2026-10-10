import unittest
from backend.media import encode_text, render_media
from backend.mesh_backend import MeshBackend
from deployment.playa_demo import apply_recording_topology


class RecordingTopologyTests(unittest.IsolatedAsyncioTestCase):
    def backend(self):
        backend = apply_recording_topology(MeshBackend(playback_speed=2, diverse_routes=True))
        return backend

    def test_large_distributed_mesh_requires_three_relays_with_alternative_links(self):
        backend = self.backend()
        self.assertEqual(backend._route('node0', 'node4'), ['node0', 'node2', 'node1', 'node3', 'node4'])
        self.assertEqual(backend._route('node4', 'node0'), ['node4', 'node3', 'node1', 'node2', 'node0'])
        self.assertEqual({node.id: (node.x, node.y) for node in backend.nodes.values()}, {
            'node0': (0, 800), 'node1': (1400, 650), 'node2': (700, 200),
            'node3': (2100, 100), 'node4': (2800, 700), 'node5': (1400, 0),
        })
        self.assertEqual([backend.nodes[n].name for n in ['node0', 'node2', 'node1', 'node4']], ['Malcome', 'Lucas', 'Shravanthi', 'Basith'])
        self.assertEqual(sum(node.online for node in backend.nodes.values()), 6)
        self.assertTrue(backend.nodes['node3'].online)
        self.assertTrue(backend.nodes['node5'].online)
        self.assertEqual(backend.playback_speed, 2)
        self.assertEqual(backend.radio_range, 1000)
        for source, destination in [('node0', 'node2'), ('node2', 'node1'), ('node1', 'node3'), ('node3', 'node4')]:
            self.assertIn(destination, backend.connections[source])
        # Connected alternative, not a claim that the shortest-route engine chose it.
        for source, destination in [('node2', 'node5'), ('node5', 'node3'), ('node1', 'node5')]:
            self.assertIn(destination, backend.connections[source])

    async def test_real_receiver_verifies_both_directions_over_actual_multi_relay_routes(self):
        backend = self.backend()
        backend.configure(playback_speed=1e9)
        for source, destination in [('node0', 'node4'), ('node4', 'node0')]:
            with self.subTest(source=source):
                text = f'{source} to {destination}: recorded route 🌊'
                media = encode_text(text)
                mid = await backend.send_message(source, destination, media.data, media_type='text', metadata=media.metadata)
                await backend.wait_message(mid)
                message = backend.get_state()['messages'][mid]
                route = message['route']
                self.assertEqual(route[0], source)
                self.assertEqual(route[-1], destination)
                self.assertGreaterEqual(len(route) - 1, 4)
                self.assertEqual(message['status'], 'delivered')
                self.assertEqual(message['receiver_status'], 'verified')
                self.assertEqual(render_media(backend.received_media[mid]).decode(), text)
                edges = {(event['source'], event['destination']) for event in backend.events if event['msg_id'] == mid and event['type'] == 'packet_tx'}
                for hop in zip(route, route[1:]):
                    self.assertIn(hop, edges)


if __name__ == '__main__':
    unittest.main()
