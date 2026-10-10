# TeamWater — Product Requirements Document
**CHRP Track: Off-Grid Everything**  
**Version:** 1.0 — Hackathon MVP | **Date:** October 10, 2026 | **Status:** Proposed

## 1. Executive summary
TeamWater is an iPhone-inspired, offline-first multimedia messaging prototype demonstrating that intelligible voice and recognizable images can travel across a severely bandwidth-constrained, lossy **simulated LoRa mesh**. At least five virtual radio nodes actually relay serialized packets, applying transmission delay and loss. Receiver verification, not optimistic sender progress, determines whether a message is delivered.

**Pitch:** The multimedia communication layer for when the internet goes down.

**Scope:** Software-only hackathon demo; no physical radios, real disconnected phones, emergency-services reliability, or validated Meshtastic/Reticulum interoperability. CHRP accessory integration is future work.

## 2. Problem and users
When cellular and Wi-Fi infrastructure are unavailable (festivals, disasters, remote environments), conventional chat apps stop working. Low-power radio can relay data through neighbors, but packet sizes, airtime, and packet loss make multimedia difficult. Users also need truthful confirmation of delivery.

**Primary persona:** An off-grid attendee trying to share a short voice note and a photo with someone beyond direct radio range.

**Job to be done:** “Help me transmit useful context, recover missing data, and tell me exactly what the recipient received.”

## 3. Goals and measurable success
### P0 demo requirements
1. Display and simulate **five or more virtual nodes**, preferably six, at map coordinates, with connectivity based on configured radio range and failures.
2. Deliver real serialized bytes across **three hops or more**; each relay must receive, queue, and forward packets, not merely animate an arrow.
3. Send text, an intelligible **2–5 second voice note**, and a recognizable compressed image.
4. Enforce **230 bytes maximum per on-air frame, including protocol metadata**. Actual media payload capacity is lower.
5. Simulate selectable bitrate, airtime, 20% independent *per-link transmission* packet loss, queueing, and node outage. Explain assumptions and PHY overhead.
6. Use selective ACKs, bounded retransmissions, deduplication, and hash-checked reassembly; successfully deliver the seeded loss-test examples.
7. Expose transmitted/received bytes, active path, failures, retries, estimated remaining time (clearly estimated), and truthful message state.
8. Show **Delivered** only after destination integrity verification *and a terminal receipt received back at the sender*.
9. Include automated deterministic unit/integration/E2E tests and reproducible judge-demo configuration.

### Reported metrics
- Delivery success rate and median/95th-percentile latency across seeded runs.
- Useful recovered encoded-media bytes / total simulated radio bytes transmitted (count headers, forwarding, ACK, and retries).
- Image quality/dimensions, audio duration/intelligibility, compression ratio, and encoded bitrate.
- Packets lost, recovered and retransmitted; airtime used; routes changed.
- **Zero false-positive delivered states**.

## 4. Non-goals
- Real CHRP hardware integration or communication between real independent networks.
- Ordinary high-resolution video streaming or real-time calling.
- Production disaster-response/security guarantees.
- Cloud-dependent AI reconstruction or production messaging account management.
- Native wire interoperability with Meshtastic or Reticulum without explicit adapter implementation and protocol testing.

**Stretch:** 2–3 compressed keyframes as a video summary, optional transcript/caption, progressive thumbnails, FEC/parity, or real multi-device client UI attached to one simulator host.

## 5. Key user flows
### Sender
Choose source node A, recipient F, and Text/Voice/Image. Composer displays source size, compressed size, and rough network ETA. Click Send. Observe progress and hops. Terminal status reflects the acknowledged recipient integrity result, not just packets queued or transmitted.

### Network operator
See a six-node topology; set packet loss (0–50%), datarate, range, random seed, and node availability. Watch route A→B→C→F; take B offline and watch an alternate *connected* route A→D→E→F if available. The simulator must never teleport packets across missing edges.

### Receiver
Display incremental chunk receipt and incomplete-media status. Only show playable/viewable reconstructed content once complete and verified. Preview-only content is clearly marked as unverified/partial.

### Three-minute judge demo
1. Send sample voice note and photo across a three-hop route.
2. Raise loss to 20%; show dropped frames and selective retries.
3. Disable a relay; show alternate routing when an alternate path is configured.
4. Hear the voice note and view the image at the receiver; show final sender receipt and efficiency counters.
5. Explain the network and codec tradeoff transparently: ordinary video is typically impractical at low LoRa bitrates.

## 6. Functional requirements and acceptance criteria
| ID | Priority | Requirement | Acceptance |
|---|---|---|---|
| FR-01 | P0 | Virtual mesh topology | ≥5 configurable nodes with range-derived edges |
| FR-02 | P0 | Actual multi-hop forwarding | Each packet logged at each physical-link transmission |
| FR-03 | P0 | Serialized frame limits | Every serialized frame ≤230 bytes including headers |
| FR-04 | P0 | Media encoding/reconstruction | Actual image and voice bytes reconstructed from received fragments |
| FR-05 | P0 | Deterministic loss model | Seed produces reproducible packet drops; configured per link |
| FR-06 | P0 | Airtime/queue simulation | Packet transmission and contention respect configured throughput assumptions |
| FR-07 | P0 | Loss recovery | Selective ACK / missing-chunk resend, duplicate and out-of-order safety |
| FR-08 | P0 | End-to-end integrity | Encoded file SHA-256 checked by destination; final receipt travels back |
| FR-09 | P0 | Honest delivery status | No successful delivery status absent a verified final receipt |
| FR-10 | P0 | Network telemetry | Route history, retries, byte efficiency, ETA, losses and queue depth |
| FR-11 | P0 | Reproducibility | Pin seed and assets; offline repeatable tests/demo |
| FR-12 | P1 | Relay outage recovery | Recompute viable route and resume missing chunks, without duplicates |
| FR-13 | P1 | Progressive preview | Preview distinguished from final verified image |
| FR-14 | P2 | Micro-video | 2–3 keyframes + optional caption within published byte budget |

## 7. Architecture recommendation
**Technology proposal:** TypeScript/Node.js deterministic simulator, React frontend, HTTP/WebSocket event stream, built-in or locally installed media codecs, Playwright E2E tests. This is proposed architecture, not an assertion about the empty repo's implementation.

```text
React (sender / recipient messenger + topology and metrics)
                        ↕ HTTP / WebSocket
Deterministic event-driven TypeScript simulator
  ├── message encoder (UTF-8, image compression, speech codec)
  ├── frame serializer / packet splitter / manifest
  ├── configurable graph and mesh router
  ├── per-node packet queues + channel airtime model
  ├── loss RNG and node failures
  ├── selective ACKs, retries, route repair, retry limits
  ├── receiver reassembly + SHA-256 verification
  └── append-only event log → message states and UI telemetry
```

Implement independent state machines for each virtual node, preferably inside one process. Use a **virtual clock** for test determinism and a slower playback setting for visible judge demos. Simulation events must correspond to actual packet operations; never let animations decide delivery.

### Packet design
Challenge guidance of ~230 bytes refers to an overall radio packet, **not guaranteed user-data payload**. Enforce a 230-byte serialized-frame cap including fields such as version, type, message ID, origin/destination IDs, current hop, chunk number/count, payload length, hop limit, and CRC. Compute maximum media payload from actual serialization overhead and test the edge cases. A message manifest carries codec, encoded-byte count, chunk count, and SHA-256. Design ACK frames under the same cap.

### Mesh logic
Compute shortest viable route from neighbors by range, with room to incorporate loss-weighted airtime cost. Enforce TTL/hop limit and loop prevention. One radio link takes time: use serialized bits ÷ configured bits/second plus modeled radio overhead and shared-channel contention. **ACKs and retries cost airtime too.** If node B goes offline, route only through connected eligible neighbors.

### Reliability protocol
Use unique message/chunk IDs, windowed transmission, periodic selective ACK bitmaps or missing-chunk lists, bounded exponential backoff, retries and deduplication. On complete reassembly, receiver validates the encoded payload hash and sends terminal integrity receipt. Sender only transitions to delivered when it receives that receipt; if final receipt is lost, display **receipt unconfirmed**, not delivered. Retry receipt queries as needed.

### Media pipeline
Text → UTF-8; image → resized low-resolution JPEG/WebP (start around 96–256px longest edge) → chunks. Voice → Codec2 if feasible, otherwise low-rate Opus with explicit compression measurements and known receiver decoder. Keep 2–5s example. Do not imply a multi-second clip arrives instantly at ~1 kbps; the estimated delay must include actual encoded size, forwarding and retransmission traffic. Cloud AI-generated visual reconstruction is out of scope and must never be represented as original pixel fidelity.

## 8. State model
**Sender:** DRAFT → ENCODING → QUEUED → TRANSMITTING → AWAITING_RECEIPT → DELIVERED. Terminal exceptions: FAILED, EXPIRED, CANCELLED.  
**Receiver:** WAITING → PARTIAL → REASSEMBLING → VERIFIED (or CORRUPT/FAILED).

Distinguish link ACK, chunk ACK, destination verification, and final sender-observed receipt. UI progress is based on received/acknowledged unique chunks; no optimistic delivery or ungrounded exact ETA. State transitions must remain coherent after duplicates and reconnects.

## 9. Test-driven implementation
**Unit tests first:**
1. Serialization round-trip, CRC, 0/1/max byte payloads, and max serialized frame size of 230 bytes.
2. Media encode/decode smoke tests; exact encoded payload bytes after reassembly.
3. Chunk ordering, duplicate reception, missing chunk timeout, tampering, hash mismatch.
4. Route constraints: ≥3 hops, TTL, correct next hops, no phantom edges.
5. Link loss seeded at 0%, 20%, 100%; measured counts and repeatability.
6. Air-time model prevents impossible parallel transmissions or free retries.
7. Sender remains unconfirmed if terminal ACK is lost.
8. Relay outage mid-transfer either reroutes successfully or times out truthfully.
9. Twenty or more seeded runs measure success ratio/p95 duration; failing seeds retained as regression fixtures.
10. Browser E2E test drives voice + image, loss toggle, and receiver verification under a pinned seed.

## 10. Prioritized workstreams
| Sequence | Workstream | Suggested owner | Deliverable |
|---|---|---|---|
| 1 | Simulator + topology + frame protocol | TBD | Seeded 5–6 node routing/airtime/loss simulation and tests |
| 2 | Reliable delivery | TBD | Selective ACK, retries, hashes, terminal receipts |
| 3 | Media codec integration | TBD | Decode verified sample image/voice from received bytes |
| 4 | Mobile-style UX / network inspector | TBD | Accurate route, counters, live statuses, controls |
| 5 | Integration + pitch | Team | Cold-start reproducible live demo and measured scorecard |

**Build order:** reliable text over multi-hop → media compression → truthful status UI → failure/rerouting → polish/keyframes. Avoid beginning with live streaming video, generative reconstruction, or hardware procurement.

### Draft API contracts
- `POST /messages` → `{sourceId, destinationId, mediaType, encodedAssetId}` ⇒ `{messageId}`
- `GET /messages/:id` → message manifest, sender/receiver states, chunks, retries, route history, timing.
- `POST /simulation/config` → `{bitRate, lossRate, rangeMeters, seed, playbackSpeed}`
- `POST /nodes/:id/status` → `{online}`
- WebSocket events: `packet_enqueued`, `packet_tx`, `packet_dropped`, `packet_rx`, `route_changed`, `chunk_ack`, `receipt_verified`, `message_state_changed`.
- Every event has monotonic sequence ID, node/link identities, and simulation timestamp.

## 11. Risks and countermeasures
| Risk | Mitigation |
|---|---|
| Voice/video transfer unrealistic at true LoRa rates | Focus on very short speech and tiny images; report time and compression |
| Multi-hop loss causes massive retransmission overhead | Selective ACK, bounded retries, efficiency metric |
| UI fakes successful transfer | Drive it from authoritative event log and final recipient verification ACK |
| Native codec integration slows development | Use simple tiny image first, local reliable audio fallback; benchmark |
| Mesh interoperability assumed | Clearly state purpose-built protocol and future Meshtastic/Reticulum adapter work |
| Demo fails randomly | Fixed seeds, offline assets, automated preflight tests, event replay |
| Impossible throughput because of parallel nodes | Serialize channel airtime with contention/queue model |
| Over-engineering | One process, modular core, strict P0/P1 scope |

## 12. Demo exit checklist
- [ ] Runs locally with one command, no external network or API dependency, with bundled sample assets.
- [ ] Displays ≥5 nodes; traffic traverses ≥3 radio hops.
- [ ] Sample voice and image travel as **actual byte packets** ≤230 bytes on every hop.
- [ ] Seeded 20% per-hop loss scenario visibly retries and completes both transfers.
- [ ] Failure case has honest non-delivered status; ACK-loss case never claims delivered.
- [ ] Route changes correctly after relay failure if fallback path exists.
- [ ] Received media renders/plays and integrity receipt returns.
- [ ] Dashboard reports size savings, transmitted bytes, losses, retries and latency.
- [ ] Unit, integration and E2E tests pass; README documents radio modeling assumptions and limits.

## 13. Judge-facing narrative
**Opening:** “Messages stop working when the internet disappears. Low-power mesh radios can relay across neighbors, but the connection is slow, unreliable, and constrained to tiny packets.”

**Demo:** “We compressed a voice note and photo, moved their bytes across multiple virtual radios, deliberately lost one in five transmissions, recovered missing packets and verified the reconstruction.”

**Close:** “We maximize useful information per radio byte and never mislead users about whether it arrived.”

## 14. Decisions to validate with the team
- Confirm challenge-defined packet size as PHY payload versus application-frame limit and actual LoRa preset/radio overhead expectations.
- Choose Codec2 vs low-rate Opus based on local encoding reliability and measured transfer budget.
- Decide how far to align simulator framing with Meshtastic/Reticulum, if at all.
- Assign engineering owners, duration and seed-based score targets before expanding to keyframes.

## 15. References
- CHRP Track: Off-Grid Everything — user-provided hackathon brief.
- [Meshtastic](https://meshtastic.org/)
- [Meshtastic radio settings](https://meshtastic.org/docs/overview/radio-settings/)
- [Reticulum](https://reticulum.network/) — architectural inspiration, not declared integration.
- [Codec2](https://www.rowetel.com/?page_id=452)

## 16. Implementation update and AI gateway extension

The initial backend uses Python/FastAPI. Preserve its public send endpoints and layer codecs and binary framing beneath them. See `docs/PACKET_MEDIA_HANDOFF.md` for actual implemented behavior and explicitly outstanding requirements; this update does not mark the original exit checklist complete.

New user-approved direction: route text AI requests over the simulated mesh to an internet-connected gateway. That gateway calls Nicrron, traces model behavior through Block Convey PRISM, and sends the actual response back over the same reliable transport. Core media messaging continues without cloud dependencies; AI access specifically requires a reachable working internet gateway.

Request and response have different transport message IDs plus a common application request ID. Gateway execution requires receiver-verified request content. Sender-visible answer completion requires verified response content, independent of request delivery. Use exact lossless compression, concise model-output budgets, gateway-side idempotency and bounded recovery. Gateway discovery, provider integration, request cache, conversation retention and failover are a subsequent workstream; transport encoding is implemented first.
