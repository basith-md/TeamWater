"""Reproducible media scorecard. Run from repository root; no network needed."""

import argparse
import asyncio
import json
import math
from pathlib import Path
import statistics
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.media import encode_voice, encode_image, encode_video
from backend.mesh_backend import MeshBackend

ROOT = Path(__file__).resolve().parents[1]


async def benchmark(seeds=20):
    media = [
        encode_voice((ROOT / "demo_assets/voice.wav").read_bytes()),
        encode_image((ROOT / "demo_assets/camp.png").read_bytes()),
        encode_video((ROOT / "demo_assets/camp.mp4").read_bytes()),
    ]
    rows = []
    for seed in range(seeds):
        backend = MeshBackend(seed=seed, playback_speed=1e9)
        for item in media:
            mid = await backend.send_message(
                "node0",
                "node5",
                item.data,
                item.metadata["media_type"],
                metadata=item.metadata,
            )
            msg = await backend.wait_message(mid)
            rows.append(
                dict(
                    seed=seed,
                    media_type=item.metadata["media_type"],
                    status=msg.status,
                    original_bytes=item.metadata["original_bytes"],
                    encoded_bytes=len(item.data),
                    transfer_bytes=msg.metadata["transfer_bytes"],
                    radio_bytes=msg.radio_bytes,
                    airtime_seconds=round(msg.airtime_seconds, 3),
                    data_retries=msg.data_retries,
                    control_retries=msg.control_retries,
                    fec_recovered=msg.fec_recovered,
                    hops=len(msg.route) - 1,
                    verified=mid in backend.received_media,
                    sha256=__import__("hashlib").sha256(item.data).hexdigest(),
                )
            )
    summary = {}
    for kind in ("voice", "image", "video"):
        group = [r for r in rows if r["media_type"] == kind]
        airtimes = sorted(r["airtime_seconds"] for r in group)
        summary[kind] = dict(
            runs=len(group),
            delivered=sum(r["status"] == "delivered" for r in group),
            original_bytes=group[0]["original_bytes"],
            encoded_bytes=group[0]["encoded_bytes"],
            mean_radio_bytes=round(statistics.mean(r["radio_bytes"] for r in group), 1),
            useful_byte_efficiency=round(
                sum(r["encoded_bytes"] for r in group if r["verified"])
                / sum(r["radio_bytes"] for r in group),
                4,
            ),
            median_airtime_seconds=round(statistics.median(airtimes), 1),
            p95_airtime_seconds=airtimes[math.ceil(0.95 * len(airtimes)) - 1],
            parity_recoveries=sum(r["fec_recovered"] for r in group),
        )
    return dict(
        configuration={
            "loss_rate": 0.2,
            "bit_rate": 1070,
            "hops": 3,
            "seeds": list(range(seeds)),
            "time_metric": "accumulated radio airtime; excludes backoff/queue idle, not end-to-end latency",
        },
        summary=summary,
        runs=rows,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="work/scorecard.json")
    parser.add_argument("--seeds", type=int, default=20)
    args = parser.parse_args()
    if args.seeds < 1:
        parser.error("--seeds must be positive")
    report = asyncio.run(benchmark(args.seeds))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["summary"], indent=2))
