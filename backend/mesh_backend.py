"""Serialized, lossy, shared-channel simulator. Not a physical LoRa implementation."""

import asyncio
import hashlib
import math
import random
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field, replace
from typing import Callable, Optional

try:
    from .packets import (
        Frame,
        DATA,
        ACK,
        RECEIPT,
        PAYLOAD_BYTES,
        DATA_BYTES,
        WINDOW_SIZE,
        PARITY,
        QUERY,
        split_transfer,
        make_parity,
    )
    from .node import MeshNode
    from .media import EncodedMedia, pack_media, unpack_media
except ImportError:
    from packets import (
        Frame,
        DATA,
        ACK,
        RECEIPT,
        PAYLOAD_BYTES,
        DATA_BYTES,
        WINDOW_SIZE,
        PARITY,
        QUERY,
        split_transfer,
        make_parity,
    )
    from node import MeshNode
    from media import EncodedMedia, pack_media, unpack_media

PACKET_PAYLOAD_SIZE = DATA_BYTES
LOSS_RATE = 0.20
BASE_RATE_BPS = 1070
RANGE = 180
MAX_HOPS = 8
LINK_RETRIES = 3
# A hop-level acknowledgement is a header-only frame; charge real airtime for it.
LINK_ACK_BYTES = 16
PHY_OVERHEAD_S = 0.05


@dataclass
class Node:
    id: str
    name: str
    x: float
    y: float
    color: str = "#007AFF"
    online: bool = True


@dataclass
class MessageProgress:
    msg_id: str
    src: str
    dst: str
    total_chunks: int
    received_chunks: set = field(default_factory=set)
    acked_chunks: set = field(default_factory=set)
    status: str = "sending"
    receiver_status: str = "waiting"
    route: list = field(default_factory=list)
    route_history: list = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    eta_seconds: Optional[float] = None
    media_type: str = "text"
    preview: str = ""
    metadata: dict = field(default_factory=dict)
    radio_bytes: int = 0
    lost_packets: int = 0
    retries: int = 0
    airtime_seconds: float = 0
    error: str = ""
    fec_recovered: int = 0
    data_retries: int = 0
    control_retries: int = 0
    frames_sent: int = 0
    started_at: float = 0
    elapsed_seconds: float = 0
    receiver_verified_at: float | None = None
    active_window: int = 0
    active_link: list = field(default_factory=list)
    route_available: bool = True
    link_retries: int = 0


class MeshBackend:
    def __init__(
        self,
        *,
        loss_rate=0.20,
        bit_rate=1070,
        seed=7,
        playback_speed=10,
        max_attempts=64,
        radio_range=180,
        drop_predicate=None,
        use_fec=True,
        link_retries=LINK_RETRIES,
    ):
        if (
            not 0 <= loss_rate <= 1
            or bit_rate <= 0
            or playback_speed <= 0
            or max_attempts < 1
            or not 0 <= link_retries <= 7
        ):
            raise ValueError("Invalid simulation configuration")
        # Per-hop retransmissions (Meshtastic next-hop routing retries a hop up to 3
        # times). End-to-end selective ACKs still guarantee the final outcome.
        self.link_retries = link_retries
        self.loss_rate, self.bit_rate = loss_rate, bit_rate
        self.playback_speed, self.max_attempts = playback_speed, max_attempts
        self.radio_range, self.seed = radio_range, seed
        self.rng = random.Random(seed)
        self.drop_predicate = drop_predicate
        self.use_fec = use_fec
        self.nodes = {}
        self.connections = defaultdict(set)
        self.messages = {}
        self.on_state_change: Optional[Callable] = None
        self._runtime = {}
        self._tasks = {}
        self._channel = asyncio.Lock()
        self.queue_depth = 0
        self.events = deque(maxlen=2000)
        self.simulation_time = 0.0
        self._sequence = 0
        self._init_nodes()

    @property
    def received_media(self):
        """Observer view of media verified by destination nodes; never read by senders."""
        return {
            mid: media
            for runtime in self._runtime.values()
            for mid, media in runtime.inbox.items()
        }

    def _init_nodes(self):
        positions = [
            (80, 260, "Alice", "#007AFF"),
            (220, 170, "Bob", "#34C759"),
            (220, 350, "Carol", "#FF9500"),
            (360, 170, "Dave", "#AF52DE"),
            (360, 350, "Eve", "#FF2D55"),
            (500, 260, "Frank", "#5AC8FA"),
        ]
        for i, (x, y, name, color) in enumerate(positions):
            self.nodes[f"node{i}"] = Node(f"node{i}", name, x, y, color)
            self._runtime[f"node{i}"] = MeshNode(i)
        self._update_connections()

    def _update_connections(self):
        self.connections.clear()
        for a in self.nodes.values():
            for b in self.nodes.values():
                if (
                    a.id != b.id
                    and a.online
                    and b.online
                    and math.hypot(a.x - b.x, a.y - b.y) <= self.radio_range
                ):
                    self.connections[a.id].add(b.id)

    def configure(self, **values):
        for key, value in values.items():
            if key == "seed":
                self.seed = value
                self.rng = random.Random(value)
            else:
                setattr(self, key, value)
        self._update_connections()
        self._notify()

    def set_node_online(self, node_id, online):
        self.nodes[node_id].online = online
        self._update_connections()
        self._notify()

    def _route(self, source, destination):
        if not self.nodes[source].online or not self.nodes[destination].online:
            return []
        queue = deque([[source]])
        seen = {source}
        while queue:
            path = queue.popleft()
            if path[-1] == destination:
                return path
            if len(path) - 1 >= MAX_HOPS:
                continue
            for neighbor in sorted(self.connections[path[-1]]):
                if neighbor not in seen:
                    seen.add(neighbor)
                    queue.append(path + [neighbor])
        return []

    def _event(self, event_type, msg, **fields):
        self._sequence += 1
        self.events.append(
            dict(
                sequence=self._sequence,
                type=event_type,
                msg_id=msg.msg_id,
                simulation_time=round(self.simulation_time, 4),
                **fields,
            )
        )
        self._notify()

    def _notify(self):
        if self.on_state_change:
            self.on_state_change()

    async def _transmit(self, frame, msg):
        source, destination = f"node{frame.source}", f"node{frame.destination}"
        path = self._route(source, destination)
        msg.route_available = bool(path)
        if not path:
            self._event("no_route", msg, source=source, destination=destination)
            return None
        if frame.kind in (DATA, PARITY, QUERY):
            msg.route = path
            if not msg.route_history or msg.route_history[-1] != path:
                msg.route_history.append(path)
        current = frame
        for a, b in zip(path, path[1:]):
            if current.ttl <= 0:
                return None
            self.queue_depth += 1
            async with self._channel:
                self.queue_depth -= 1
                delivered = await self._hop(current, msg, a, b)
            if delivered is None:
                msg.active_link = []
                return None
            current = delivered
        msg.active_link = []
        return current

    async def _on_air(self, msg, nbytes):
        """Charge airtime for one transmission on the shared channel."""
        # Approximate fixed PHY overhead; serialized app bytes reported separately.
        duration = nbytes * 8 / self.bit_rate + PHY_OVERHEAD_S
        msg.radio_bytes += nbytes
        msg.frames_sent += 1
        msg.airtime_seconds += duration
        await asyncio.sleep(duration / self.playback_speed)
        self.simulation_time += duration

    async def _hop(self, current, msg, a, b):
        """One link-layer exchange: send, wait for the hop ACK, retry the hop.

        Returns the frame as the next node parsed it, or None if every attempt on
        this link was lost. A lost hop ACK costs a duplicate transmission but the
        next node already holds the frame, so forwarding still proceeds.
        """
        wire = current.serialize()
        received = None
        for attempt in range(1 + self.link_retries):
            if b not in self.connections[a]:
                break
            if attempt:
                msg.link_retries += 1
            msg.active_link = [a, b]
            self._event(
                "packet_tx",
                msg,
                source=a,
                destination=b,
                kind=current.kind,
                chunk=current.index,
                frame_bytes=len(wire),
                link_attempt=attempt + 1,
            )
            await self._on_air(msg, len(wire))
            lost = self.rng.random() < self.loss_rate
            if self.drop_predicate and self.drop_predicate(current, a, b):
                lost = True
            if lost or b not in self.connections[a]:
                msg.lost_packets += 1
                self._event(
                    "packet_dropped",
                    msg,
                    source=a,
                    destination=b,
                    kind=current.kind,
                    link_attempt=attempt + 1,
                )
                continue
            if received is None:
                # Every relay reads the actual serialized bytes and forwards a fresh frame.
                received = replace(Frame.deserialize(wire), ttl=current.ttl - 1)
                self._event(
                    "packet_rx",
                    msg,
                    source=a,
                    destination=b,
                    kind=current.kind,
                    chunk=current.index,
                )
            if not self.link_retries:
                break  # no hop-level ARQ configured: nothing to acknowledge
            await self._on_air(msg, LINK_ACK_BYTES)
            if self.rng.random() < self.loss_rate:
                msg.lost_packets += 1
                self._event("hop_ack_dropped", msg, source=b, destination=a)
                continue
            break
        return received

    async def send_message(
        self, src, dst, data, media_type="text", preview="", metadata=None
    ):
        if src not in self.nodes or dst not in self.nodes or src == dst:
            raise ValueError("Choose two distinct known nodes")
        metadata = metadata or {
            "codec": "utf8" if media_type == "text" else "binary",
            "mime": (
                "text/plain" if media_type == "text" else "application/octet-stream"
            ),
            "original_bytes": len(data),
        }
        envelope = pack_media(
            EncodedMedia(data, {**metadata, "media_type": media_type})
        )
        chunks = split_transfer(envelope)
        msg_id = str(uuid.uuid4())
        msg = MessageProgress(
            msg_id,
            src,
            dst,
            len(chunks),
            media_type=media_type,
            preview=preview,
            metadata={
                **metadata,
                "encoded_bytes": len(data),
                "transfer_bytes": len(envelope),
            },
        )
        self.messages[msg_id] = msg
        self._tasks[msg_id] = asyncio.create_task(
            self._send(msg, chunks, hashlib.sha256(envelope).digest())
        )
        self._notify()
        return msg_id

    def _deliver(self, frame, msg):
        """Hand an arrived frame to its destination node; return that node's reply."""
        reply = self._runtime[f"node{frame.destination}"].handle(frame)
        self._observe(msg)
        return reply

    def _observe(self, msg):
        """Telemetry only: copy destination-node state for the UI and tests.

        The sender's protocol decisions never read this; it learns solely from
        frames returned over the simulated radio.
        """
        receiver = self._runtime[msg.dst].receivers.get(msg.msg_id)
        if receiver is None:
            return
        before = msg.fec_recovered
        msg.received_chunks = set(receiver.chunks)
        msg.fec_recovered = len(receiver.recovered)
        msg.receiver_status = "verified" if receiver.media else "partial"
        if receiver.media and msg.receiver_verified_at is None:
            msg.receiver_verified_at = (
                time.monotonic() - msg.started_at
            ) * self.playback_speed
        if msg.fec_recovered > before:
            self._event("fec_recovered", msg, chunk_ids=sorted(receiver.recovered))
        self._notify()

    async def _send(self, msg, chunks, expected_digest):
        msg.started_at = time.monotonic()
        source, destination = int(msg.src[4:]), int(msg.dst[4:])
        attempts_by_chunk = defaultdict(int)
        try:
            for base in range(0, len(chunks), WINDOW_SIZE):
                msg.active_window = base
                indexes = list(range(base, min(base + WINDOW_SIZE, len(chunks))))
                pending = indexes[:]
                confirmed = False
                for attempt in range(self.max_attempts):
                    if attempt:
                        await asyncio.sleep(
                            min(0.25 * 2 ** min(attempt, 4), 4) / self.playback_speed
                        )
                    # Sender uses only returned ACK bitmap, never receiver's shared buffer.
                    for index in pending:
                        if attempts_by_chunk[index]:
                            msg.data_retries += 1
                            msg.retries += 1
                        attempts_by_chunk[index] += 1
                        frame = Frame(
                            DATA,
                            msg.msg_id,
                            source,
                            destination,
                            index,
                            len(chunks),
                            chunks[index],
                        )
                        arrived = await self._transmit(frame, msg)
                        if arrived:
                            self._deliver(arrived, msg)
                    if attempt == 0 and self.use_fec and len(indexes) > 1:
                        frame = Frame(
                            PARITY,
                            msg.msg_id,
                            source,
                            destination,
                            base,
                            len(chunks),
                            make_parity([chunks[i] for i in indexes]),
                        )
                        arrived = await self._transmit(frame, msg)
                        if arrived:
                            self._deliver(arrived, msg)
                    # A tiny query elicits a bitmap or final receipt. Lost control frames
                    # cause query retries, not a resend of an entire known-good window.
                    if attempt:
                        msg.control_retries += 1
                        msg.retries += 1
                    query = Frame(
                        QUERY, msg.msg_id, source, destination, base, len(chunks)
                    )
                    arrived = await self._transmit(query, msg)
                    pending = []
                    if not arrived:
                        continue
                    if base + WINDOW_SIZE >= len(chunks):
                        msg.status = "awaiting_receipt"
                    response = self._deliver(arrived, msg)
                    returned = await self._transmit(response, msg)
                    if returned is None:
                        continue
                    if returned.kind == RECEIPT:
                        if returned.payload != expected_digest:
                            raise ValueError("Terminal receipt digest mismatch")
                        msg.acked_chunks.update(range(len(chunks)))
                        msg.status = "delivered"
                        self._event("receipt_verified", msg)
                        return
                    if len(returned.payload) != 1 or returned.index != base:
                        raise ValueError("Invalid selective ACK")
                    acknowledged = [
                        i for i in indexes if returned.payload[0] & (1 << (i - base))
                    ]
                    msg.acked_chunks.update(acknowledged)
                    pending = [i for i in indexes if i not in msg.acked_chunks]
                    msg.status = "in_transit"
                    self._event("chunk_ack", msg, chunk_ids=acknowledged)
                    if not pending:
                        confirmed = True
                        break
                if not confirmed:
                    # Presentation label from observer telemetry; retry logic above
                    # used only frames that came back over the radio.
                    msg.status = (
                        "receipt_unconfirmed"
                        if msg.receiver_status == "verified"
                        else "failed"
                    )
                    msg.error = "Retry budget exhausted; delivery is not confirmed"
                    return
        except asyncio.CancelledError:
            msg.status = "cancelled"
            raise
        except Exception as exc:
            msg.status = "failed"
            msg.error = str(exc)
        finally:
            msg.elapsed_seconds = (
                time.monotonic() - msg.started_at
            ) * self.playback_speed
            msg.active_link = []
            self._notify()

    async def wait_message(self, msg_id):
        await self._tasks[msg_id]
        return self.messages[msg_id]

    async def close(self):
        for task in self._tasks.values():
            task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)

    def _chunk_data(self, data):
        return split_transfer(data)

    def _hop_cost(self, nbytes):
        """Expected airtime of one hop exchange and probability the hop succeeds."""
        p, r = self.loss_rate, self.link_retries
        tx = nbytes * 8 / self.bit_rate + PHY_OVERHEAD_S
        if r == 0:
            return tx, 1 - p
        ack = LINK_ACK_BYTES * 8 / self.bit_rate + PHY_OVERHEAD_S
        q = (1 - p) ** 2  # frame and its hop ACK both survive
        tries = (1 - (1 - q) ** (r + 1)) / q if q else r + 1
        return tries * (tx + (1 - p) * ack), 1 - p ** (r + 1)

    def get_nodes(self):
        return [{"id": n.id, "name": n.name} for n in self.nodes.values()]

    def get_state(self):
        messages = {}
        for mid, m in self.messages.items():
            route = self._route(m.src, m.dst)
            hops = len(route) - 1
            remaining = m.total_chunks - len(m.acked_chunks)
            eta = None
            if m.status == "delivered":
                eta = 0
            elif (
                hops > 0
                and self.loss_rate < 1
                and m.status not in ("failed", "receipt_unconfirmed", "cancelled")
            ):
                # Conservative model excludes parity benefit and includes selective
                # ACK traffic plus per-hop retransmissions and hop ACK airtime.
                data_hop, hop_ok = self._hop_cost(230)
                ctrl_hop, _ = self._hop_cost(64)
                one_way = hop_ok**hops
                windows = math.ceil(remaining / WINDOW_SIZE)
                data_time = remaining * hops * data_hop / one_way
                if self.use_fec:
                    # One parity frame per window costs airtime even when unused.
                    data_time *= 1 + 1 / WINDOW_SIZE
                control_time = windows * 2 * hops * ctrl_hop / (one_way**2)
                eta = round(data_time + control_time, 1)
            messages[mid] = dict(
                msg_id=mid,
                src=m.src,
                dst=m.dst,
                total_chunks=m.total_chunks,
                received=len(m.received_chunks),
                acked=len(m.acked_chunks),
                status=m.status,
                receiver_status=m.receiver_status,
                route=m.route,
                route_history=m.route_history,
                eta=eta,
                eta_basis="estimated simulated seconds; excludes other queued messages",
                media_type=m.media_type,
                preview=m.preview[:80],
                progress=len(m.acked_chunks) / m.total_chunks,
                created_at=m.created_at,
                metadata=m.metadata,
                radio_bytes=m.radio_bytes,
                airtime_seconds=round(m.airtime_seconds, 3),
                retries=m.retries,
                lost_packets=m.lost_packets,
                fec_recovered=m.fec_recovered,
                data_retries=m.data_retries,
                control_retries=m.control_retries,
                link_retries=m.link_retries,
                frames_sent=m.frames_sent,
                received_ids=sorted(m.received_chunks),
                acked_ids=sorted(m.acked_chunks),
                missing_ids=[
                    i for i in range(m.total_chunks) if i not in m.received_chunks
                ],
                active_link=m.active_link,
                route_available=bool(route),
                elapsed_seconds=round(
                    (
                        m.elapsed_seconds
                        if m.status
                        in ("delivered", "failed", "receipt_unconfirmed", "cancelled")
                        else (
                            (time.monotonic() - m.started_at) * self.playback_speed
                            if m.started_at
                            else 0
                        )
                    ),
                    2,
                ),
                receiver_verified_at=m.receiver_verified_at,
                error=m.error,
                content_url=(
                    f"/messages/{mid}/content" if mid in self.received_media else None
                ),
                efficiency=(
                    round(m.metadata["encoded_bytes"] / m.radio_bytes, 4)
                    if mid in self.received_media and m.radio_bytes
                    else 0
                ),
            )
        return dict(
            nodes=[vars(n) for n in self.nodes.values()],
            connections={k: sorted(v) for k, v in self.connections.items()},
            messages=messages,
            simulation=dict(
                loss_rate=self.loss_rate,
                bit_rate=self.bit_rate,
                seed=self.seed,
                playback_speed=self.playback_speed,
                simulation_time=self.simulation_time,
                queue_depth=self.queue_depth,
                fec=self.use_fec,
                link_retries=self.link_retries,
                window_size=WINDOW_SIZE,
                range_meters=self.radio_range,
                model="shared channel, store-and-forward, per-hop ACK + retry, 50ms overhead per frame",
            ),
            events=list(self.events)[-100:],
        )
