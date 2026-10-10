"""
CHRP Mesh Service
FastAPI + WebSocket service that exposes the MeshBackend.
Other services can also import MeshBackend directly and skip this layer.
"""

import asyncio
from copy import deepcopy
import os
from typing import Set

import uvicorn
from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    UploadFile,
    File,
    Form,
    HTTPException,
)
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, Response

import sys
from pathlib import Path

# Allow imports both from repo root and direct service.py execution
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# Allow importing the backend from the sibling directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from mesh_backend import MeshBackend
from media import (
    encode_text,
    encode_image,
    encode_voice,
    encode_video,
    render_media,
    MAX_UPLOAD,
)

from shared.python.models import SimulationConfig, RoutingConfig, NodePosition
from connect.app import create_app as create_connect_app

try:
    from .ai_gateway import AiGateway
except ImportError:
    from ai_gateway import AiGateway

app = FastAPI(title="CHRP Mesh Service")
backend = MeshBackend(playback_speed=float(os.environ.get("TEAMWATER_PLAYBACK_SPEED", "2")), diverse_routes=True)

# Water Connect runs in this process under /connect; with WATER_DEMO=1 every node's phone is
# already connected to one shared TeamWater account, so the AI tab works with no sign-up.
connect_app = create_connect_app()
_demo = getattr(connect_app.state, "demo", None)
gateway = None  # created below, once on_backend_change exists


def full_state():
    return {**backend.get_state(), "ai": gateway.state() if gateway else None}


# Track connected WebSocket clients
connected_clients: Set[WebSocket] = set()


async def broadcast_state():
    """Push current mesh state to all connected WebSocket clients."""
    if not connected_clients:
        return
    state = {"type": "state", **full_state()}
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send_json(state)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


_broadcast_task = None


async def delayed_broadcast():
    await asyncio.sleep(0.04)
    await broadcast_state()


def on_backend_change():
    """Coalesce per-hop events instead of starting overlapping WebSocket writes."""
    global _broadcast_task
    if _broadcast_task is None or _broadcast_task.done():
        _broadcast_task = asyncio.create_task(delayed_broadcast())


# Register the callback so the backend notifies us of changes
backend.on_state_change = on_backend_change
gateway = AiGateway(lambda: backend, connect_app, _demo["devices"] if _demo else {}, on_backend_change,
                    internet_node=os.environ.get("TEAMWATER_INTERNET_NODE", "node5"))


CONSOLE_DIST = Path(__file__).resolve().parent.parent / "apps" / "console" / "dist"


class StripApiPrefix:
    """Let the console's default '/api' endpoint work when served from this process."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket") and (
            scope["path"] == "/api" or scope["path"].startswith("/api/")
        ):
            path = scope["path"][4:] or "/"
            scope = {**scope, "path": path, "raw_path": path.encode()}
        await self.inner(scope, receive, send)


@app.get("/", response_class=HTMLResponse)
async def root():
    built = CONSOLE_DIST / "index.html"
    if built.exists():
        return built.read_text()
    html_path = Path(__file__).resolve().parent / "static" / "index.html"
    return html_path.read_text()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    # Send initial state
    await websocket.send_json({"type": "state", **full_state()})
    try:
        while True:
            await websocket.receive_text()  # keep alive / future commands
    except WebSocketDisconnect:
        connected_clients.discard(websocket)


async def submit_media(src, dst, media, preview):
    try:
        msg_id = await backend.send_message(
            src,
            dst,
            media.data,
            media.metadata["media_type"],
            preview,
            metadata=media.metadata,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "msg_id": msg_id,
        "original": media.metadata["original_bytes"],
        "compressed": len(media.data),
        "chunks": backend.messages[msg_id].total_chunks,
        "metadata": media.metadata,
    }


@app.post("/send/text")
async def send_text(src: str = Form(...), dst: str = Form(...), text: str = Form(...)):
    try:
        media = encode_text(text)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return await submit_media(src, dst, media, text[:60])


async def read_and_encode(file, encoder):
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "Upload exceeds 10 MiB")
    try:
        return await asyncio.to_thread(encoder, raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/send/image")
async def send_image(
    src: str = Form(...), dst: str = Form(...), file: UploadFile = File(...)
):
    media = await read_and_encode(file, encode_image)
    return await submit_media(
        src, dst, media, f"Image {media.metadata['width']}x{media.metadata['height']}"
    )


@app.post("/send/voice")
async def send_voice(
    src: str = Form(...), dst: str = Form(...), file: UploadFile = File(...)
):
    media = await read_and_encode(file, encode_voice)
    return await submit_media(src, dst, media, "Codec2 voice (first 5 seconds maximum)")


@app.post("/send/video")
async def send_video(
    src: str = Form(...), dst: str = Form(...), file: UploadFile = File(...)
):
    media = await read_and_encode(file, encode_video)
    return await submit_media(src, dst, media, media.metadata["quality_label"])


@app.post("/simulation/config")
async def configure_simulation(config: SimulationConfig):
    if any(not task.done() for task in backend._tasks.values()):
        raise HTTPException(
            409, "Wait for active transfers to finish before changing radio settings"
        )
    backend.configure(**config.model_dump(exclude_none=True))
    return backend.get_state()["simulation"]


@app.post("/simulation/routing")
async def configure_routing(config: RoutingConfig):
    if any(not task.done() for task in backend._tasks.values()):
        raise HTTPException(409, "Wait for active transfers to finish before changing routing")
    backend.configure(distance_routing=config.distance_routing)
    return backend.get_state()["simulation"]


@app.post("/simulation/nodes/{node_id}/position")
async def move_node(node_id: str, position: NodePosition):
    if node_id not in backend.nodes:
        raise HTTPException(404, "Unknown node")
    if not (0 <= position.x <= 10000 and 0 <= position.y <= 10000):
        raise HTTPException(422, "Position outside the map")
    if any(not task.done() for task in backend._tasks.values()):
        raise HTTPException(409, "Wait for active transfers to finish before moving nodes")
    backend.move_node(node_id, position.x, position.y)
    return backend.get_state()["simulation"]


@app.post("/simulation/reset")
async def reset_simulation():
    global backend
    nodes = deepcopy(backend.nodes)
    config = dict(
        loss_rate=backend.loss_rate,
        bit_rate=backend.bit_rate,
        seed=backend.seed,
        playback_speed=backend.playback_speed,
        radio_range=backend.radio_range,
        use_fec=backend.use_fec,
        link_retries=backend.link_retries,
        diverse_routes=backend.diverse_routes,
        distance_routing=backend.distance_routing,
        max_attempts=backend.max_attempts,
    )
    await backend.close()
    await gateway.close()
    gateway.requests.clear()
    backend = MeshBackend(**config)
    backend.nodes = nodes
    backend.configure()
    backend.on_state_change = on_backend_change
    on_backend_change()
    return backend.get_state()


@app.post("/demo/{media_type}")
async def send_demo(media_type: str):
    assets = Path(__file__).resolve().parent.parent / "demo_assets"
    choices = {
        "voice": ("voice.wav", encode_voice),
        "image": ("camp.png", encode_image),
        "video": ("camp.mp4", encode_video),
    }
    if media_type not in choices:
        raise HTTPException(404, "Unknown demo media")
    name, encoder = choices[media_type]
    media = await asyncio.to_thread(encoder, (assets / name).read_bytes())
    return await submit_media("node0", "node5", media, f"Demo {media_type}")


@app.post("/ai/ask")
async def ai_ask(src: str = Form(...), question: str = Form(...), model_index: int = Form(0)):
    """Ask Water AI from a phone. The question crosses the mesh to the internet node."""
    try:
        return {"request_id": await gateway.ask(src, question, model_index)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/ai/gateway")
async def ai_set_gateway(node_id: str = Form("")):
    """Choose which node has internet. Empty means no node does (AI waits honestly)."""
    try:
        gateway.set_internet_node(node_id or None)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"internet_node": gateway.internet_node}


@app.get("/messages/{msg_id}/content")
async def received_content(msg_id: str):
    if msg_id not in backend.messages:
        raise HTTPException(404, "Unknown message")
    media = backend.received_media.get(msg_id)
    if media is None:
        raise HTTPException(409, "Receiver has not verified complete content")
    return Response(
        render_media(media),
        media_type=media.metadata.get("playback_mime", media.metadata["mime"]),
        headers={"X-Content-Type-Options": "nosniff"},
    )


@app.post("/nodes/{node_id}/status")
async def node_status(node_id: str, online: bool = Form(...)):
    if node_id not in backend.nodes:
        raise HTTPException(404, "Unknown node")
    backend.set_node_online(node_id, online)
    return {"node_id": node_id, "online": online}


@app.get("/nodes")
async def get_nodes():
    return backend.get_nodes()


@app.get("/state")
async def get_state():
    """REST endpoint so other services can poll state without WebSockets."""
    return full_state()


app.mount("/connect", connect_app)

# Serve static files (the demo UI)
app.mount(
    "/static",
    StaticFiles(directory=str(Path(__file__).resolve().parent / "static")),
    name="static",
)

if (CONSOLE_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(CONSOLE_DIST / "assets")), name="assets")

app.add_middleware(StripApiPrefix)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
