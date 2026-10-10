"""
CHRP Mesh Backend
Pure mesh simulation engine — no HTTP, no WebSocket, no UI.
Other services can import and use this directly.
"""

import asyncio
import math
import random
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Set, Any
from collections import defaultdict

# --- Configuration ---
PACKET_PAYLOAD_SIZE = 200  # bytes usable for data after headers
LOSS_RATE = 0.20           # 20% packet loss
BASE_RATE_BPS = 5000       # ~5 kbps effective
HOP_DELAY_MS = 50
RANGE = 180                # meters
MAX_HOPS = 4


@dataclass
class Node:
    id: str
    name: str
    x: float
    y: float
    color: str = "#007AFF"


@dataclass
class Packet:
    packet_id: str
    msg_id: str
    src: str
    dst: str
    hop_count: int
    path: List[str]
    chunk_index: int
    total_chunks: int
    is_ack: bool
    payload: bytes
    timestamp: float = field(default_factory=time.time)


@dataclass
class MessageProgress:
    msg_id: str
    src: str
    dst: str
    total_chunks: int
    received_chunks: Set[int] = field(default_factory=set)
    acked_chunks: Set[int] = field(default_factory=set)
    status: str = "sending"          # sending | in_transit | reassembled | delivered | failed
    route: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    eta_seconds: float = 0.0
    media_type: str = "text"
    preview: str = ""


class MeshBackend:
    """
    Core mesh simulator.
    Other services can instantiate this and call send_message().
    Register an on_state_change callback to receive updates.
    """

    def __init__(self):
        self.nodes: Dict[str, Node] = {}
        self.connections: Dict[str, Set[str]] = defaultdict(set)
        self.seen_packets: Set[str] = set()
        self.messages: Dict[str, MessageProgress] = {}
        self.on_state_change: Optional[Callable[[], None]] = None
        self._init_nodes()

    def _init_nodes(self):
        positions = [
            (80, 300, "Alice", "#007AFF"),
            (180, 180, "Bob", "#34C759"),
            (280, 320, "Carol", "#FF9500"),
            (380, 200, "Dave", "#AF52DE"),
            (480, 340, "Eve", "#FF2D55"),
            (520, 120, "Frank", "#5AC8FA"),
        ]
        for i, (x, y, name, color) in enumerate(positions):
            nid = f"node{i}"
            self.nodes[nid] = Node(nid, name, x, y, color)
        self._update_connections()

    def _update_connections(self):
        self.connections.clear()
        ids = list(self.nodes.keys())
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                if self._distance(a, b) <= RANGE:
                    self.connections[a].add(b)
                    self.connections[b].add(a)

    def _distance(self, a: str, b: str) -> float:
        na, nb = self.nodes[a], self.nodes[b]
        return math.hypot(na.x - nb.x, na.y - nb.y)

    def get_state(self) -> Dict[str, Any]:
        """Return a serializable snapshot of the current mesh state."""
        return {
            "nodes": [
                {"id": n.id, "name": n.name, "x": n.x, "y": n.y, "color": n.color}
                for n in self.nodes.values()
            ],
            "connections": {k: list(v) for k, v in self.connections.items()},
            "messages": {
                mid: {
                    "msg_id": m.msg_id,
                    "src": m.src,
                    "dst": m.dst,
                    "total_chunks": m.total_chunks,
                    "received": len(m.received_chunks),
                    "acked": len(m.acked_chunks),
                    "status": m.status,
                    "route": m.route,
                    "eta": round(m.eta_seconds, 1),
                    "media_type": m.media_type,
                    "preview": m.preview[:80],
                    "progress": len(m.acked_chunks) / max(1, m.total_chunks),
                    "created_at": m.created_at,
                }
                for mid, m in self.messages.items()
            },
        }

    def _notify(self):
        if self.on_state_change:
            try:
                self.on_state_change()
            except Exception:
                pass

    async def simulate_packet(self, packet: Packet):
        if packet.packet_id in self.seen_packets:
            return
        self.seen_packets.add(packet.packet_id)

        current = packet.src
        visited = {current}
        queue = [(current, 0, [current])]

        while queue:
            node, hops, path = queue.pop(0)
            if hops > MAX_HOPS:
                continue

            if node == packet.dst or packet.dst in self.connections.get(node, set()):
                if random.random() > LOSS_RATE:
                    delay = (hops + 1) * (HOP_DELAY_MS / 1000) + (len(packet.payload) * 8 / BASE_RATE_BPS)
                    await asyncio.sleep(delay * 0.3)
                    await self._handle_delivery(packet, path + [packet.dst])
                return

            for neighbor in self.connections.get(node, set()):
                if neighbor not in visited:
                    visited.add(neighbor)
                    if random.random() > LOSS_RATE:
                        queue.append((neighbor, hops + 1, path + [neighbor]))

    async def _handle_delivery(self, packet: Packet, path: List[str]):
        msg = self.messages.get(packet.msg_id)
        if not msg:
            return

        if packet.is_ack:
            if packet.dst == msg.src:
                msg.acked_chunks.add(packet.chunk_index)
                msg.status = "delivered" if len(msg.acked_chunks) == msg.total_chunks else "in_transit"
                msg.route = path
                self._update_eta(msg)
                self._notify()
            return

        if packet.dst == msg.dst:
            msg.received_chunks.add(packet.chunk_index)
            msg.route = path
            ack = Packet(
                packet_id=str(uuid.uuid4())[:8],
                msg_id=packet.msg_id,
                src=packet.dst,
                dst=packet.src,
                hop_count=0,
                path=[],
                chunk_index=packet.chunk_index,
                total_chunks=packet.total_chunks,
                is_ack=True,
                payload=b"",
            )
            asyncio.create_task(self.simulate_packet(ack))
            self._update_eta(msg)
            if len(msg.received_chunks) == msg.total_chunks:
                msg.status = "reassembled"
            self._notify()

    def _update_eta(self, msg: MessageProgress):
        remaining = msg.total_chunks - len(msg.acked_chunks)
        if remaining <= 0:
            msg.eta_seconds = 0
            return
        bytes_left = remaining * PACKET_PAYLOAD_SIZE
        effective_rate = BASE_RATE_BPS * (1 - LOSS_RATE) / 2
        msg.eta_seconds = bytes_left * 8 / max(1, effective_rate)

    async def send_message(
        self,
        src: str,
        dst: str,
        data: bytes,
        media_type: str = "text",
        preview: str = "",
    ) -> str:
        """Send a message across the mesh. Returns the message ID."""
        if src not in self.nodes or dst not in self.nodes:
            raise ValueError("Unknown src or dst node")

        msg_id = str(uuid.uuid4())[:8]
        chunks = self._chunk_data(data)
        progress = MessageProgress(
            msg_id=msg_id,
            src=src,
            dst=dst,
            total_chunks=len(chunks),
            media_type=media_type,
            preview=preview,
        )
        self.messages[msg_id] = progress
        self._notify()

        for i, chunk in enumerate(chunks):
            pkt = Packet(
                packet_id=str(uuid.uuid4())[:8],
                msg_id=msg_id,
                src=src,
                dst=dst,
                hop_count=0,
                path=[src],
                chunk_index=i,
                total_chunks=len(chunks),
                is_ack=False,
                payload=chunk,
            )
            asyncio.create_task(self.simulate_packet(pkt))
            await asyncio.sleep(0.05)

        asyncio.create_task(self._retransmit_loop(msg_id, chunks))
        return msg_id

    def _chunk_data(self, data: bytes) -> List[bytes]:
        if not data:
            return [b""]
        return [data[i:i + PACKET_PAYLOAD_SIZE] for i in range(0, len(data), PACKET_PAYLOAD_SIZE)]

    async def _retransmit_loop(self, msg_id: str, chunks: List[bytes]):
        for attempt in range(5):
            await asyncio.sleep(2.0 + attempt)
            msg = self.messages.get(msg_id)
            if not msg or msg.status == "delivered":
                return
            missing = [i for i in range(msg.total_chunks) if i not in msg.acked_chunks]
            for i in missing[:3]:
                pkt = Packet(
                    packet_id=str(uuid.uuid4())[:8],
                    msg_id=msg_id,
                    src=msg.src,
                    dst=msg.dst,
                    hop_count=0,
                    path=[msg.src],
                    chunk_index=i,
                    total_chunks=msg.total_chunks,
                    is_ack=False,
                    payload=chunks[i],
                )
                asyncio.create_task(self.simulate_packet(pkt))
            self._notify()

    def get_nodes(self) -> List[Dict[str, str]]:
        return [{"id": n.id, "name": n.name} for n in self.nodes.values()]
