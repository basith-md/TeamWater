"""Receiver state: accepts bytes in any order without consulting sender buffers."""

import hashlib

try:
    from .packets import DATA, PARITY, DATA_BYTES, WINDOW_SIZE, recover_one
    from .media import unpack_media
except ImportError:
    from packets import DATA, PARITY, DATA_BYTES, WINDOW_SIZE, recover_one
    from media import unpack_media


class Receiver:
    def __init__(self, count):
        self.count = count
        self.chunks = {}
        self.parity = {}
        self.recovered = set()
        self.media = None
        self.digest = None

    def accept(self, frame):
        if frame.count != self.count:
            raise ValueError("Conflicting chunk count")
        if frame.kind == DATA:
            if len(frame.payload) > DATA_BYTES:
                raise ValueError("Data chunk exceeds capacity")
            self._store(frame.index, frame.payload)
        elif frame.kind == PARITY:
            if frame.index % WINDOW_SIZE:
                raise ValueError("Invalid parity window")
            previous = self.parity.get(frame.index)
            if previous is not None and previous != frame.payload:
                raise ValueError("Conflicting parity")
            self.parity[frame.index] = frame.payload
        base = frame.index - frame.index % WINDOW_SIZE
        if base in self.parity:
            count = min(WINDOW_SIZE, self.count - base)
            present = {
                i: self.chunks[base + i]
                for i in range(count)
                if base + i in self.chunks
            }
            recovery = recover_one(present, self.parity[base], count)
            if recovery:
                index, data = recovery
                self._store(base + index, data)
                self.recovered.add(base + index)
        if len(self.chunks) == self.count and self.media is None:
            assembled = b"".join(self.chunks[i] for i in range(self.count))
            self.media = unpack_media(assembled)
            self.digest = hashlib.sha256(assembled).digest()

    def _store(self, index, data):
        if index in self.chunks and self.chunks[index] != data:
            raise ValueError("Conflicting duplicate chunk")
        self.chunks[index] = data

    def bitmap(self, base):
        return bytes(
            [
                sum(
                    1 << i
                    for i in range(min(WINDOW_SIZE, self.count - base))
                    if base + i in self.chunks
                )
            ]
        )
