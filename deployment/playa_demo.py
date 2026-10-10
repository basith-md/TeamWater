"""Recording configuration around the unchanged merged mesh engine."""
def apply_recording_topology(backend):
    names = {
        'node0': 'Malcome', 'node1': 'Shravanthi', 'node2': 'Lucas',
        'node3': 'Dave', 'node4': 'Basith', 'node5': 'Frank',
    }
    # Preserve the team's distributed positions, range and routing algorithm.
    for node_id, name in names.items():
        backend.nodes[node_id].name = name
    backend.configure(playback_speed=20)
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
