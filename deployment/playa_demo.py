"""Recording configuration around the unchanged merged mesh engine."""
def apply_recording_topology(backend):
    names = {
        'node0': 'Malcome', 'node1': 'Shravanthi', 'node2': 'Lucas',
        'node3': 'Dave', 'node4': 'Basith', 'node5': 'Frank',
    }
    positions = {
        'node0': (0, 800), 'node2': (700, 200), 'node1': (1400, 650),
        'node3': (2100, 100), 'node4': (2800, 700), 'node5': (1400, 0),
    }
    # A 2.8 km scene with cycles, using the engine's actual range-based graph.
    # The source and destination require at least three intermediate relays.
    for node_id, name in names.items():
        backend.nodes[node_id].name = name
        backend.nodes[node_id].x, backend.nodes[node_id].y = positions[node_id]
        backend.nodes[node_id].online = True
    # Keep the service's TEAMWATER_PLAYBACK_SPEED setting (default 2x).
    backend.configure(radio_range=1000)
    return backend

from service import service
app = service.app
from contextlib import asynccontextmanager
original_lifespan = app.router.lifespan_context

@asynccontextmanager
async def recording_lifespan(app):
    # Run inside the ASGI startup loop because configure() emits a real snapshot.
    async with original_lifespan(app):
        apply_recording_topology(service.backend)
        yield

app.router.lifespan_context = recording_lifespan
