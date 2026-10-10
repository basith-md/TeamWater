"""
CHRP Mesh Service
FastAPI + WebSocket service that exposes the MeshBackend.
Other services can also import MeshBackend directly and skip this layer.
"""

import asyncio
import io
from typing import Set

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from PIL import Image

import sys
from pathlib import Path

# Allow importing the backend from the sibling directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from mesh_backend import MeshBackend

app = FastAPI(title="CHRP Mesh Service")
backend = MeshBackend()

# Track connected WebSocket clients
connected_clients: Set[WebSocket] = set()


async def broadcast_state():
    """Push current mesh state to all connected WebSocket clients."""
    if not connected_clients:
        return
    state = {"type": "state", **backend.get_state()}
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send_json(state)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


def on_backend_change():
    """Callback registered with the backend so we push updates immediately."""
    asyncio.create_task(broadcast_state())


# Register the callback so the backend notifies us of changes
backend.on_state_change = on_backend_change


@app.get("/", response_class=HTMLResponse)
async def root():
    html_path = Path(__file__).resolve().parent / "static" / "index.html"
    return html_path.read_text()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    # Send initial state
    await websocket.send_json({"type": "state", **backend.get_state()})
    try:
        while True:
            await websocket.receive_text()  # keep alive / future commands
    except WebSocketDisconnect:
        connected_clients.discard(websocket)


@app.post("/send/text")
async def send_text(src: str = Form(...), dst: str = Form(...), text: str = Form(...)):
    data = text.encode("utf-8")
    preview = text[:60]
    msg_id = await backend.send_message(src, dst, data, "text", preview)
    return {"msg_id": msg_id, "chunks": len(backend._chunk_data(data))}


@app.post("/send/image")
async def send_image(src: str = Form(...), dst: str = Form(...), file: UploadFile = File(...)):
    raw = await file.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    img.thumbnail((96, 96))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=25, optimize=True)
    compressed = buf.getvalue()
    preview = f"Image {img.size[0]}x{img.size[1]} ({len(compressed)}B)"
    msg_id = await backend.send_message(src, dst, compressed, "image", preview)
    return {
        "msg_id": msg_id,
        "original": len(raw),
        "compressed": len(compressed),
        "chunks": len(backend._chunk_data(compressed)),
    }


@app.post("/send/voice")
async def send_voice(src: str = Form(...), dst: str = Form(...), file: UploadFile = File(...)):
    raw = await file.read()
    compressed = raw[:1200]  # placeholder aggressive compression
    preview = f"Voice note ({len(compressed)}B compressed)"
    msg_id = await backend.send_message(src, dst, compressed, "voice", preview)
    return {"msg_id": msg_id, "chunks": len(backend._chunk_data(compressed))}


@app.get("/nodes")
async def get_nodes():
    return backend.get_nodes()


@app.get("/state")
async def get_state():
    """REST endpoint so other services can poll state without WebSockets."""
    return backend.get_state()


# Serve static files (the demo UI)
app.mount("/static", StaticFiles(directory=str(Path(__file__).resolve().parent / "static")), name="static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
