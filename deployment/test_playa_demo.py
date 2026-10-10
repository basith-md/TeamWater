import unittest
from backend.media import encode_text, render_media
from backend.mesh_backend import MeshBackend
from deployment.playa_demo import apply_recording_topology


class RecordingTopologyTests(unittest.IsolatedAsyncioTestCase):
    def backend(self):
        backend = apply_recording_topology(MeshBackend())
        return backend

    def test_default_distributed_mesh_keeps_actual_shortest_route_and_alternative_links(self):
        backend = self.backend()
        self.assertEqual(backend._route('node0', 'node4'), ['node0', 'node2', 'node4'])
        self.assertEqual(backend._route('node4', 'node0'), ['node4', 'node2', 'node0'])
        self.assertEqual({node.id: (node.x, node.y) for node in backend.nodes.values()}, {
            'node0': (80, 260), 'node1': (220, 170), 'node2': (220, 350),
            'node3': (360, 170), 'node4': (360, 350), 'node5': (500, 260),
        })
        self.assertEqual([backend.nodes[n].name for n in ['node0', 'node2', 'node1', 'node4']], ['Malcome', 'Lucas', 'Shravanthi', 'Basith'])
        self.assertEqual(sum(node.online for node in backend.nodes.values()), 6)
        self.assertTrue(backend.nodes['node3'].online)
        self.assertTrue(backend.nodes['node5'].online)
        self.assertEqual(backend.playback_speed, 20)
        for source, destination in [('node0', 'node2'), ('node2', 'node4')]:
            self.assertIn(destination, backend.connections[source])
        # Connected alternative, not a claim that the shortest-route engine chose it.
        for source, destination in [('node0', 'node1'), ('node1', 'node3'), ('node3', 'node4')]:
            self.assertIn(destination, backend.connections[source])

    async def test_real_receiver_verifies_both_directions_over_actual_shortest_route(self):
        backend = self.backend()
        backend.configure(playback_speed=1e9)
        for source, destination, route in [('node0', 'node4', ['node0', 'node2', 'node4']), ('node4', 'node0', ['node4', 'node2', 'node0'])]:
            with self.subTest(source=source):
                text = f'{source} to {destination}: recorded route 🌊'
                media = encode_text(text)
                mid = await backend.send_message(source, destination, media.data, media_type='text', metadata=media.metadata)
                await backend.wait_message(mid)
                message = backend.get_state()['messages'][mid]
                self.assertEqual(message['route'], route)
                self.assertEqual(message['status'], 'delivered')
                self.assertEqual(message['receiver_status'], 'verified')
                self.assertEqual(render_media(backend.received_media[mid]).decode(), text)
                edges = {(event['source'], event['destination']) for event in backend.events if event['msg_id'] == mid and event['type'] == 'packet_tx'}
                for hop in zip(route, route[1:]):
                    self.assertIn(hop, edges)


if __name__ == '__main__':
    unittest.main()
