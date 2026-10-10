"""
CHRP Mesh Service
FastAPI + WebSocket service that exposes the MeshBackend.
Other services can also import MeshBackend directly and skip this layer.
"""

import asyncio
import io
from typing import Set

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, Response
from PIL import Image

import sys
from pathlib import Path

# Allow importing the backend from the sibling directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from mesh_backend import MeshBackend
from media import encode_text, encode_image, encode_voice, render_media, MAX_UPLOAD

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


async def submit_media(src, dst, media, preview):
    try:
        msg_id = await backend.send_message(src, dst, media.data,
            media.metadata["media_type"], preview, metadata=media.metadata)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"msg_id": msg_id, "original": media.metadata["original_bytes"],
            "compressed": len(media.data), "chunks": backend.messages[msg_id].total_chunks,
            "metadata": media.metadata}


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
async def send_image(src: str = Form(...), dst: str = Form(...), file: UploadFile = File(...)):
    media = await read_and_encode(file, encode_image)
    return await submit_media(src, dst, media, f"Image {media.metadata['width']}x{media.metadata['height']}")


@app.post("/send/voice")
async def send_voice(src: str = Form(...), dst: str = Form(...), file: UploadFile = File(...)):
    media = await read_and_encode(file, encode_voice)
    return await submit_media(src, dst, media, "Opus voice (first 5 seconds maximum)")


@app.get("/messages/{msg_id}/content")
async def received_content(msg_id: str):
    if msg_id not in backend.messages:
        raise HTTPException(404, "Unknown message")
    media = backend.received_media.get(msg_id)
    if media is None:
        raise HTTPException(409, "Receiver has not verified complete content")
    return Response(render_media(media), media_type=media.metadata["mime"],
                    headers={"X-Content-Type-Options": "nosniff"})


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
    return backend.get_state()


# Serve static files (the demo UI)
app.mount("/static", StaticFiles(directory=str(Path(__file__).resolve().parent / "static")), name="static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
