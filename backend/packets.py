"""Application framing for our simulator, not Meshtastic wire compatibility."""
import struct
import uuid
import zlib
from dataclasses import dataclass

MAX_FRAME_BYTES = 230
_HEADER = struct.Struct('!2sBB16sBBHHH')
CRC_BYTES = 4
PAYLOAD_BYTES = MAX_FRAME_BYTES - _HEADER.size - CRC_BYTES
DATA, ACK, RECEIPT = 1, 2, 3

@dataclass(frozen=True)
class Frame:
    kind: int
    message_id: str
    source: int
    destination: int
    index: int
    count: int
    payload: bytes = b''
    ttl: int = 8

    def serialize(self):
        if self.kind not in (DATA, ACK, RECEIPT):
            raise ValueError('Unknown frame type')
        if not 0 <= self.index < self.count <= 65535:
            raise ValueError('Invalid chunk index/count')
        if len(self.payload) > PAYLOAD_BYTES:
            raise ValueError('Frame exceeds 230 bytes')
        header = _HEADER.pack(b'TW', self.kind, self.ttl, uuid.UUID(self.message_id).bytes,
                              self.source, self.destination, self.index, self.count, len(self.payload))
        body = header + self.payload
        return body + struct.pack('!I', zlib.crc32(body))

    @classmethod
    def deserialize(cls, wire):
        if not _HEADER.size + CRC_BYTES <= len(wire) <= MAX_FRAME_BYTES:
            raise ValueError('Invalid frame length')
        body, crc = wire[:-4], wire[-4:]
        if zlib.crc32(body) != struct.unpack('!I', crc)[0]:
            raise ValueError('CRC mismatch')
        magic, kind, ttl, mid, src, dst, index, count, size = _HEADER.unpack(body[:_HEADER.size])
        if magic != b'TW' or size != len(body) - _HEADER.size:
            raise ValueError('Invalid frame header')
        frame = cls(kind, str(uuid.UUID(bytes=mid)), src, dst, index, count, body[_HEADER.size:], ttl)
        frame.serialize()  # same validation on reception
        return frame


def split(data):
    return [data[i:i + PAYLOAD_BYTES] for i in range(0, len(data), PAYLOAD_BYTES)] or [b'']
