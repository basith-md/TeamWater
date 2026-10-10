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
    from .packets import Frame, DATA, ACK, RECEIPT, PAYLOAD_BYTES, split
    from .media import EncodedMedia, pack_media, unpack_media
except ImportError:
    from packets import Frame, DATA, ACK, RECEIPT, PAYLOAD_BYTES, split
    from media import EncodedMedia, pack_media, unpack_media

PACKET_PAYLOAD_SIZE = PAYLOAD_BYTES
LOSS_RATE = .20
BASE_RATE_BPS = 1070
RANGE = 180
MAX_HOPS = 8

@dataclass
class Node:
    id: str
    name: str
    x: float
    y: float
    color: str = '#007AFF'
    online: bool = True

@dataclass
class MessageProgress:
    msg_id: str
    src: str
    dst: str
    total_chunks: int
    received_chunks: set = field(default_factory=set)
    acked_chunks: set = field(default_factory=set)
    status: str = 'sending'
    receiver_status: str = 'waiting'
    route: list = field(default_factory=list)
    route_history: list = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    eta_seconds: Optional[float] = None
    media_type: str = 'text'
    preview: str = ''
    metadata: dict = field(default_factory=dict)
    radio_bytes: int = 0
    lost_packets: int = 0
    retries: int = 0
    airtime_seconds: float = 0
    error: str = ''

class MeshBackend:
    def __init__(self, *, loss_rate=.20, bit_rate=1070, seed=7, playback_speed=10,
                 max_attempts=64, radio_range=180, drop_predicate=None):
        if not 0 <= loss_rate <= 1 or bit_rate <= 0 or playback_speed <= 0 or max_attempts < 1:
            raise ValueError('Invalid simulation configuration')
        self.loss_rate, self.bit_rate = loss_rate, bit_rate
        self.playback_speed, self.max_attempts = playback_speed, max_attempts
        self.radio_range, self.seed = radio_range, seed
        self.rng = random.Random(seed)
        self.drop_predicate = drop_predicate
        self.nodes = {}
        self.connections = defaultdict(set)
        self.messages = {}
        self.on_state_change: Optional[Callable] = None
        self._buffers = defaultdict(dict)
        self.received_media = {}
        self._tasks = {}
        self._channel = asyncio.Lock()
        self.events = deque(maxlen=2000)
        self.simulation_time = 0.0
        self._sequence = 0
        self._init_nodes()

    def _init_nodes(self):
        positions = [(80,300,'Alice','#007AFF'), (180,180,'Bob','#34C759'),
                     (280,320,'Carol','#FF9500'), (380,200,'Dave','#AF52DE'),
                     (480,340,'Eve','#FF2D55'), (520,120,'Frank','#5AC8FA')]
        for i, (x,y,name,color) in enumerate(positions):
            self.nodes[f'node{i}'] = Node(f'node{i}',name,x,y,color)
        self._update_connections()

    def _update_connections(self):
        self.connections.clear()
        for a in self.nodes.values():
            for b in self.nodes.values():
                if a.id != b.id and a.online and b.online and math.hypot(a.x-b.x,a.y-b.y) <= self.radio_range:
                    self.connections[a.id].add(b.id)

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
        self.events.append(dict(sequence=self._sequence, type=event_type, msg_id=msg.msg_id,
                                simulation_time=round(self.simulation_time, 4), **fields))
        self._notify()

    def _notify(self):
        if self.on_state_change:
            self.on_state_change()

    async def _transmit(self, frame, msg):
        source, destination = f'node{frame.source}', f'node{frame.destination}'
        path = self._route(source, destination)
        if not path:
            self._event('no_route', msg, source=source, destination=destination)
            return None
        if frame.kind == DATA:
            msg.route = path
            if not msg.route_history or msg.route_history[-1] != path:
                msg.route_history.append(path)
        current = frame
        for a,b in zip(path, path[1:]):
            if current.ttl <= 0:
                return None
            async with self._channel:
                if b not in self.connections[a]:
                    return None
                wire = current.serialize()
                # Approximate fixed PHY overhead; serialized app bytes reported separately.
                duration = len(wire) * 8 / self.bit_rate + .05
                msg.radio_bytes += len(wire)
                msg.airtime_seconds += duration
                self._event('packet_tx', msg, source=a, destination=b, kind=frame.kind,
                            chunk=frame.index, frame_bytes=len(wire))
                await asyncio.sleep(duration / self.playback_speed)
                self.simulation_time += duration
                lost = self.rng.random() < self.loss_rate
                if self.drop_predicate and self.drop_predicate(current, a, b):
                    lost = True
                if lost or b not in self.connections[a]:
                    msg.lost_packets += 1
                    self._event('packet_dropped', msg, source=a, destination=b, kind=frame.kind)
                    return None
                # Every relay reads the actual serialized bytes and forwards a fresh frame.
                current = replace(Frame.deserialize(wire), ttl=current.ttl-1)
                self._event('packet_rx', msg, source=a, destination=b, kind=frame.kind, chunk=frame.index)
        return current

    async def send_message(self, src, dst, data, media_type='text', preview='', metadata=None):
        if src not in self.nodes or dst not in self.nodes or src == dst:
            raise ValueError('Choose two distinct known nodes')
        metadata = metadata or {'codec':'utf8' if media_type=='text' else 'binary',
                                'mime':'text/plain' if media_type=='text' else 'application/octet-stream',
                                'original_bytes':len(data)}
        envelope = pack_media(EncodedMedia(data, {**metadata, 'media_type':media_type}))
        chunks = split(envelope)
        msg_id = str(uuid.uuid4())
        msg = MessageProgress(msg_id, src, dst, len(chunks), media_type=media_type,
                              preview=preview, metadata={**metadata, 'encoded_bytes':len(data),
                                                        'transfer_bytes':len(envelope)})
        self.messages[msg_id] = msg
        self._tasks[msg_id] = asyncio.create_task(self._send(msg, chunks, hashlib.sha256(envelope).digest()))
        self._notify()
        return msg_id

    async def _send(self, msg, chunks, expected_digest):
        try:
            # Window size one: selective per-chunk ACK, bounded retries, no free ACKs.
            for index, payload in enumerate(chunks):
                success = False
                for attempt in range(self.max_attempts):
                    if attempt:
                        msg.retries += 1
                        await asyncio.sleep(min(.25 * 2 ** min(attempt, 4), 4) / self.playback_speed)
                    frame = Frame(DATA, msg.msg_id, int(msg.src[4:]), int(msg.dst[4:]), index, len(chunks), payload)
                    received = await self._transmit(frame, msg)
                    if received is None:
                        continue
                    buffer = self._buffers[msg.msg_id]
                    if index in buffer and buffer[index] != received.payload:
                        raise ValueError('Conflicting duplicate chunk')
                    buffer[index] = received.payload
                    msg.received_chunks.add(index)
                    msg.receiver_status = 'partial'
                    if len(buffer) == len(chunks):
                        assembled = b''.join(buffer[i] for i in range(len(chunks)))
                        media = unpack_media(assembled)
                        self.received_media[msg.msg_id] = media
                        msg.receiver_status = 'verified'
                        msg.status = 'awaiting_receipt'
                        receipt = Frame(RECEIPT, msg.msg_id, frame.destination, frame.source,
                                        index, len(chunks), hashlib.sha256(assembled).digest())
                        returned = await self._transmit(receipt, msg)
                        if returned and returned.payload == expected_digest:
                            msg.acked_chunks.update(range(len(chunks)))
                            msg.status = 'delivered'
                            msg.eta_seconds = 0
                            self._event('receipt_verified', msg)
                            return
                        # Retry final data chunk to elicit another final receipt.
                    else:
                        ack = Frame(ACK, msg.msg_id, frame.destination, frame.source, index, len(chunks))
                        returned = await self._transmit(ack, msg)
                        if returned:
                            msg.acked_chunks.add(index)
                            msg.status = 'in_transit'
                            success = True
                            break
                    self._notify()
                if not success:
                    msg.status = 'receipt_unconfirmed' if msg.receiver_status == 'verified' else 'failed'
                    msg.error = 'Retry budget exhausted'
                    return
        except Exception as exc:
            msg.status = 'failed'
            msg.error = str(exc)
        finally:
            self._notify()

    async def wait_message(self, msg_id):
        await self._tasks[msg_id]
        return self.messages[msg_id]

    async def close(self):
        for task in self._tasks.values():
            task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)

    def _chunk_data(self, data):
        return split(data)

    def get_nodes(self):
        return [{'id':n.id,'name':n.name} for n in self.nodes.values()]

    def get_state(self):
        messages = {}
        for mid,m in self.messages.items():
            route = self._route(m.src,m.dst)
            hops = len(route)-1
            remaining = m.total_chunks-len(m.acked_chunks)
            eta = None
            if m.status == 'delivered':
                eta = 0
            elif hops > 0 and self.loss_rate < 1 and m.status not in ('failed','receipt_unconfirmed'):
                # Conservative stop-and-wait estimate; excludes competing messages and retry caps.
                success = (1-self.loss_rate) ** (2*hops)
                eta = round(remaining*hops*((230+64)*8/self.bit_rate+.1)/success,1)
            messages[mid] = dict(msg_id=mid,src=m.src,dst=m.dst,total_chunks=m.total_chunks,
                received=len(m.received_chunks),acked=len(m.acked_chunks),status=m.status,
                receiver_status=m.receiver_status,route=m.route,route_history=m.route_history,
                eta=eta,eta_basis='estimated simulated seconds; excludes other queued messages',
                media_type=m.media_type,preview=m.preview[:80],progress=len(m.acked_chunks)/m.total_chunks,
                created_at=m.created_at,metadata=m.metadata,radio_bytes=m.radio_bytes,
                airtime_seconds=round(m.airtime_seconds,3),retries=m.retries,lost_packets=m.lost_packets,
                error=m.error,content_url=f'/messages/{mid}/content' if mid in self.received_media else None,
                efficiency=round(m.metadata['encoded_bytes']/m.radio_bytes,4) if mid in self.received_media and m.radio_bytes else 0)
        return dict(nodes=[vars(n) for n in self.nodes.values()],
                    connections={k:sorted(v) for k,v in self.connections.items()},messages=messages,
                    simulation=dict(loss_rate=self.loss_rate,bit_rate=self.bit_rate,seed=self.seed,
                                    playback_speed=self.playback_speed,simulation_time=self.simulation_time,
                                    model='shared channel, store-and-forward, 50ms overhead per hop'),
                    events=list(self.events)[-100:])
