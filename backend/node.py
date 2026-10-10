"""Per-node protocol state. A node knows only what arrived as serialized frames."""

try:
    from .packets import ACK, DATA, PARITY, QUERY, RECEIPT, Frame
    from .reassembly import Receiver
except ImportError:
    from packets import ACK, DATA, PARITY, QUERY, RECEIPT, Frame
    from reassembly import Receiver


class MeshNode:
    def __init__(self, node_number):
        self.number = node_number
        self.receivers = {}

    def handle(self, frame):
        """Process a frame addressed to this node; return a reply frame or None."""
        if frame.destination != self.number:
            raise ValueError("Frame delivered to the wrong node")
        if frame.kind not in (DATA, PARITY, QUERY):
            return None
        receiver = self.receivers.setdefault(frame.message_id, Receiver(frame.count))
        if frame.kind != QUERY:
            receiver.accept(frame)
            return None
        if receiver.count != frame.count:
            raise ValueError("Conflicting chunk count")
        if receiver.media is not None:
            kind, payload = RECEIPT, receiver.digest
        else:
            kind, payload = ACK, receiver.bitmap(frame.index)
        return Frame(
            kind,
            frame.message_id,
            self.number,
            frame.source,
            frame.index,
            frame.count,
            payload,
        )

    @property
    def inbox(self):
        return {
            mid: r.media for mid, r in self.receivers.items() if r.media is not None
        }
