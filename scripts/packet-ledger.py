"""Read-only terminal view of the running TeamWater mesh service."""
import argparse
import asyncio
import json
import math
import shutil
import sys
from urllib.parse import urlsplit, urlunsplit
from urllib.request import urlopen


LABELS = {"packet_tx": "TX", "packet_rx": "RX", "packet_dropped": "DROP",
          "packet_retry": "RETRY", "receipt_verified": "VERIFIED", "route_changed": "ROUTE"}


def clean(value):
    return "".join(character for character in str(value) if character.isprintable())


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def format_event(event, names):
    at = f"{event['simulation_time']:.2f}" if number(event.get("simulation_time")) else "—"
    size = f"{event['frame_bytes']} B" if number(event.get("frame_bytes")) else "—"
    source = clean(names.get(event.get("source"), event.get("source", "—")))[:10]
    destination = clean(names.get(event.get("destination"), event.get("destination", "—")))[:10]
    chunk = f"#{event['chunk']}" if event.get("chunk") is not None else "—"
    packet = f"{clean(event.get('msg_id', '—'))[:8]} {chunk}"
    if event.get("kind") is not None:
        packet += f"/{clean(event['kind'])}"
    label = LABELS.get(event.get("type"), clean(event.get("type", "—")))
    return f"{at:>7} {label:<8} {packet:<14} {source:<10} → {destination:<10} {size:>6}"


class PacketLedger:
    def __init__(self, limit=300):
        self.limit = limit
        self.events = []
        self.nodes = []
        self.last_sequence = 0
        self.simulation_time = None

    def apply(self, snapshot):
        if isinstance(snapshot.get("nodes"), list):
            self.nodes = snapshot["nodes"]
        raw = [row for row in snapshot.get("events", [])
               if isinstance(row, dict) and isinstance(row.get("sequence"), int)]
        latest = max((row["sequence"] for row in raw), default=0)
        previous = {row["sequence"]: row for row in self.events}
        reused = any(row["sequence"] in previous and
                     previous[row["sequence"]].get("msg_id") != row.get("msg_id") for row in raw)
        if (raw and latest < self.last_sequence) or reused or (not raw and snapshot.get("messages") == {}):
            self.events = []
            self.last_sequence = 0
        self.events.extend(row for row in raw if row["sequence"] > self.last_sequence)
        self.events.sort(key=lambda row: row["sequence"])
        self.events = self.events[-self.limit:]
        self.last_sequence = max(self.last_sequence, latest)
        self.simulation_time = snapshot.get("simulation", {}).get("simulation_time")

    def render(self, width=100, height=24, status="Connected"):
        names = {node["id"]: node.get("name", node["id"]) for node in self.nodes}
        online = sum(node.get("online") is True for node in self.nodes)
        lines = ["WATER CONNECT · LIVE PACKET LEDGER (read-only)", clean(status),
                 f"NODES · {online}/{len(self.nodes)} online"]
        lines.extend(f"  {clean(node.get('name', node['id'])):<12} {clean(node['id']):<8} "
                     f"{'ONLINE' if node.get('online') else 'OFFLINE'}" for node in self.nodes)
        lines.extend(["", "SIM (s) EVENT    MESSAGE/CHUNK  SOURCE       DESTINATION  BYTES"])
        rows = [row for row in self.events if row.get("type") in LABELS]
        room = max(0, height - len(lines) - 1)
        lines.extend(format_event(row, names) for row in rows[-room:] if room)
        if not rows and room:
            lines.append("Waiting for real packet events…")
        lines.append("Ctrl+C to exit · — means bytes not reported · newest events at bottom")
        return "\n".join(line[:max(1, width)] for line in lines[:max(1, height)])


def draw(ledger, status):
    size = shutil.get_terminal_size((100, 30))
    prefix = "\033[2J\033[H" if sys.stdout.isatty() else ""
    suffix = "" if sys.stdout.isatty() else "\n"
    sys.stdout.write(prefix + ledger.render(size.columns, size.lines, status) + suffix)
    sys.stdout.flush()


async def follow(url):
    import websockets
    from websockets.exceptions import WebSocketException
    ledger = PacketLedger()
    while True:
        try:
            draw(ledger, f"Connecting · {url}")
            async with websockets.connect(url, max_size=8 * 1024 * 1024) as socket:
                draw(ledger, f"Connected · {url}")
                async for payload in socket:
                    snapshot = json.loads(payload)
                    if isinstance(snapshot, dict) and snapshot.get("type") == "state":
                        ledger.apply(snapshot)
                        draw(ledger, f"Connected · {url}")
        except (OSError, ValueError, WebSocketException) as failure:
            draw(ledger, f"Reconnecting in 2s · {type(failure).__name__}: {clean(failure)}")
            await asyncio.sleep(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="ws://127.0.0.1:8003/ws")
    parser.add_argument("--once", action="store_true", help="Read one HTTP state snapshot and exit")
    args = parser.parse_args()
    if args.once:
        url = urlsplit(args.url)
        path = url.path.removesuffix("/ws") + "/state"
        endpoint = urlunsplit(("https" if url.scheme == "wss" else "http", url.netloc, path, "", ""))
        with urlopen(endpoint, timeout=5) as response:
            snapshot = json.load(response)
        ledger = PacketLedger()
        ledger.apply(snapshot)
        draw(ledger, f"Snapshot · {endpoint}")
    else:
        try:
            asyncio.run(follow(args.url))
        except KeyboardInterrupt:
            print("\nLedger closed. Backend continues running.")


if __name__ == "__main__":
    main()
