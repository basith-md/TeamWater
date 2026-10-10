"""Application framing for our simulator, not Meshtastic wire compatibility."""

import struct
import uuid
import zlib
from dataclasses import dataclass

MAX_FRAME_BYTES = 230
_HEADER = struct.Struct("!2sBB16sBBHHH")
CRC_BYTES = 4
PAYLOAD_BYTES = MAX_FRAME_BYTES - _HEADER.size - CRC_BYTES
DATA, ACK, RECEIPT, PARITY, QUERY = 1, 2, 3, 4, 5
WINDOW_SIZE = 4
DATA_BYTES = PAYLOAD_BYTES - WINDOW_SIZE * 2


@dataclass(frozen=True)
class Frame:
    kind: int
    message_id: str
    source: int
    destination: int
    index: int
    count: int
    payload: bytes = b""
    ttl: int = 8

    def serialize(self):
        if self.kind not in (DATA, ACK, RECEIPT, PARITY, QUERY):
            raise ValueError("Unknown frame type")
        if not 0 <= self.index < self.count <= 65535:
            raise ValueError("Invalid chunk index/count")
        if len(self.payload) > PAYLOAD_BYTES:
            raise ValueError("Frame exceeds 230 bytes")
        header = _HEADER.pack(
            b"TW",
            self.kind,
            self.ttl,
            uuid.UUID(self.message_id).bytes,
            self.source,
            self.destination,
            self.index,
            self.count,
            len(self.payload),
        )
        body = header + self.payload
        return body + struct.pack("!I", zlib.crc32(body))

    @classmethod
    def deserialize(cls, wire):
        if not _HEADER.size + CRC_BYTES <= len(wire) <= MAX_FRAME_BYTES:
            raise ValueError("Invalid frame length")
        body, crc = wire[:-4], wire[-4:]
        if zlib.crc32(body) != struct.unpack("!I", crc)[0]:
            raise ValueError("CRC mismatch")
        magic, kind, ttl, mid, src, dst, index, count, size = _HEADER.unpack(
            body[: _HEADER.size]
        )
        if magic != b"TW" or size != len(body) - _HEADER.size:
            raise ValueError("Invalid frame header")
        frame = cls(
            kind,
            str(uuid.UUID(bytes=mid)),
            src,
            dst,
            index,
            count,
            body[_HEADER.size :],
            ttl,
        )
        frame.serialize()  # same validation on reception
        return frame


def split(data):
    return [
        data[i : i + PAYLOAD_BYTES] for i in range(0, len(data), PAYLOAD_BYTES)
    ] or [b""]


def split_transfer(data):
    """Leave room for four original lengths inside a full-size parity frame."""
    return [data[i : i + DATA_BYTES] for i in range(0, len(data), DATA_BYTES)] or [b""]


def make_parity(chunks):
    if not 1 <= len(chunks) <= WINDOW_SIZE or any(len(c) > DATA_BYTES for c in chunks):
        raise ValueError("Invalid parity group")
    lengths = [len(c) for c in chunks] + [0] * (WINDOW_SIZE - len(chunks))
    parity = bytearray(DATA_BYTES)
    for chunk in chunks:
        for i, byte in enumerate(chunk):
            parity[i] ^= byte
    return struct.pack("!4H", *lengths) + parity


def recover_one(chunks, parity, count):
    """Recover exactly one missing chunk; two or more require retransmission."""
    if len(parity) != PAYLOAD_BYTES or not 1 <= count <= WINDOW_SIZE:
        raise ValueError("Invalid parity payload")
    lengths = struct.unpack("!4H", parity[:8])
    if any(length > DATA_BYTES for length in lengths):
        raise ValueError("Invalid parity lengths")
    missing = [i for i in range(count) if i not in chunks]
    if len(missing) != 1:
        return None
    restored = bytearray(parity[8:])
    for index, chunk in chunks.items():
        if not 0 <= index < count or len(chunk) != lengths[index]:
            raise ValueError("Parity data length mismatch")
        for i, byte in enumerate(chunk):
            restored[i] ^= byte
    index = missing[0]
    return index, bytes(restored[: lengths[index]])
