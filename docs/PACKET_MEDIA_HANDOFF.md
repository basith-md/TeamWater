# Packet and media implementation handoff

Implemented against commit `7b52137` on local branch `codex/packet-media-pipeline`.

## What changed

The existing FastAPI routes remain `/send/text`, `/send/image`, `/send/voice`, `/state`, `/nodes`, and `/ws`. Uploads still use multipart fields `src`, `dst`, and `file` (or `text`). `send_message` remains usable directly; it returns immediately with a message ID and schedules the transfer.

- `backend/media.py`: exact UTF-8 or zlib text, whichever is smaller; WebP images at 160px maximum edge and quality 20; FFmpeg/libopus mono audio targeting 6 kbps, first five seconds maximum. Opus bitrate is a target, not a claim about the final Ogg container size. Voice requires FFmpeg built with libopus, and receiver browser Ogg/Opus support. Invalid audio is rejected rather than truncated.
- `backend/packets.py`: 230-byte frame limit, 28-byte binary header, 4-byte CRC32, 198-byte content capacity. Full UUID, source/destination numeric node IDs, kind, TTL, chunk index/count and payload length. This is a custom simulated protocol, not Meshtastic-compatible firmware.
- A JSON manifest travels inside the chunk stream with codec, MIME type, byte counts and SHA-256. It costs bandwidth too: tiny messages may need more than one packet. CRC/hash checks detect corruption; they do not encrypt or authenticate messages.
- `backend/mesh_backend.py`: actual per-hop serialization/deserialization, range-derived routes, one shared radio channel, seeded per-hop loss, TTL, receiver byte buffers, deduplication, selective per-chunk ACKs, bounded retries and a SHA-256 terminal receipt. ACKs and receipts travel through the same loss/airtime model.
- `GET /messages/{id}/content`: only returns the receiver's fully reassembled, verified data. Text is decompressed, images and audio return their actual received encoded bytes. Before verification returns 409. Sender confirmation can still be missing while receiver content is available.
- `POST /nodes/{id}/status` with form field `online`: recompute reachable links. Retry routes cannot cross absent edges.
- Existing UI displays verified image/audio, receiver state, losses, retries and byte counters. Playback controls persist across updates. Text previews are explicitly sender-side; received full text is available through the content endpoint.

## Run

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m uvicorn service.service:app --host 127.0.0.1 --port 8000
```

Install FFmpeg separately with libopus support. Open http://localhost:8000. Alice to Frank is four hops with the existing coordinates; the UI now defaults to that route. Default simulation is 1.07 kbps, 20% independent per-hop loss, seed 7, 10x playback. ETA reports estimated network seconds, not accelerated wall-clock seconds.

## Teammate integration

```python
from backend.media import encode_text, encode_ai_message, render_media
from backend.mesh_backend import MeshBackend

backend = MeshBackend()
media = encode_text('Meet at the north entrance.')
message_id = await backend.send_message(
    'node0', 'node5', media.data,
    media_type=media.metadata['media_type'], metadata=media.metadata,
)
# UI subscribes to existing state/WebSocket snapshots.
# Awaiting is useful for tests or a gateway worker, not the HTTP send handler.
await backend.wait_message(message_id)
if message_id in backend.received_media:
    received_bytes = render_media(backend.received_media[message_id])
```

Use `metadata.encoded_bytes` for encoded media size and `metadata.transfer_bytes` for encoded media plus manifest size. Send route response `chunks` is the actual count including manifest. `radio_bytes` counts every transmitted application frame at every hop, including ACKs, receipts, drops and retries. `airtime_seconds` includes approximate PHY overhead; it is not total end-to-end latency. `efficiency` is verified encoded media bytes divided by radio bytes. `receiver_status=verified` differs from sender `status=delivered`.

## Next: AI gateway (not implemented)

1. Add gateway availability/internet state to the node model. Select a reachable, internet-connected gateway, never an arbitrary disconnected node.
2. Create a UUID request ID. `encode_ai_message(prompt, request_id, conversation_id=...)` produces a losslessly compressed JSON envelope for transport. Send it to the gateway using `send_message`.
3. Only after receiver verification, parse `render_media(...)` at the gateway. Cache request IDs to avoid repeated API charges after duplicate radio requests. Gateway cache/failover coordination remains separate work.
4. Invoke Nicrron from the server with credentials in environment variables. Trace that cloud call to PRISM. Do not put credentials in radio packets or browser JavaScript.
5. Encode the actual answer with `encode_ai_message(answer, request_id, is_response=True)` and send it from gateway to origin using the same mesh API. The shared request ID correlates two distinct transport message IDs.
6. Expose stages: request transmitting → gateway received → model working → answer transmitting → answer verified. Request delivery must never imply answer delivery.
7. Keep short response budgets and conversation state at the gateway. Lossless compression is distinct from asking the model for a concise answer. Include original short prompt/required context if failing over to another gateway, or explicitly report lost context.
8. Add gateway outage/failover tests and a real provider smoke test. Off-grid nodes need a reachable working gateway; completely disconnected networks cannot use cloud AI.

## Validation and limits

14 automated tests pass, including 20 seeds at 20% loss, a four-hop route, 0%/100% loss, duplicate ACK recovery, missing final receipts, corrupt payloads, packet bounds, true image decoding, Opus decode and duration, media mesh transfer, API content gating, and AI request/reply transport. Synthetic silence validates audio encoding/decoding; it does not establish speech intelligibility. Listen to an actual spoken clip before judging audio quality.

This is a hackathon baseline. It uses a stop-and-wait window of one with up to 64 attempts per chunk; end-to-end ACK loss makes it bandwidth-expensive. The seed-6 failure with a 24-attempt limit is retained in the 20-seed sweep. A larger budget improves completion but can lengthen failures. Sliding windows, bitmap ACKs and hop-local recovery are next optimizations; FEC/parity is not implemented.

The simulator uses asyncio playback, a per-instance seeded RNG, shared-channel serialization and 50ms approximate overhead per hop. It is not a complete deterministic discrete-event PHY simulator: scheduling of concurrent sends/outages can affect event order, and the exported simulation clock accumulates channel airtime rather than idle/backoff wall time. No collision, interference, regulatory duty-cycle or frequency-specific range model is included. Default topology has no alternate route around Bob. A viable alternate must be configured before claiming outage rerouting.

Browser smoke test covers text/status. Full automated browser voice/image upload/playback tests, perceptual quality checks, codec benchmarking and a gateway integration remain outstanding. Memory is in-process and currently retained for the session; restart clears it. No encryption, authentication, production rate limiting or persistent queue is provided. Video remains PRD stretch scope.
