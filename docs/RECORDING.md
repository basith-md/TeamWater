# Playa meetup recording

Open http://localhost:5173 in Chrome. The console has one live simulator mode.

Malcome is at Mayan Warrior in deep playa. Basith is at the playa airport.
Lucas, Shravanthi, Dave, and Frank are other participants relaying messages.
All six nodes are online across a 2.8 km scene, with a configured 1,000 m radio
range. The radio graph requires at least four hops between Malcome and Basith:
Malcome → Lucas → Shravanthi → Dave → Basith is one shortest path, and Frank
provides an alternate path between Lucas and Dave. The engine selects the actual
route; the wrapper does not force a path. The live service varies eligible routes
between messages. Distance-aware routing instead selects the minimum modeled
expected-transmission cost and exposes its route comparison.

## Start

From the repository root, use two terminals:

```sh
.venv/bin/python -m uvicorn deployment.playa_demo:app --host 127.0.0.1 --port 8003
```

```sh
TEAMWATER_BACKEND_URL=http://127.0.0.1:8003 npm run dev --workspace @teamwater/console -- --port 5173 --strictPort
```

The recording wrapper only configures the team's mesh engine. It uses 20% packet
loss, 1,070 bps, per-hop retries, and the service's default 2× simulation playback.
Set `TEAMWATER_PLAYBACK_SPEED` before startup to choose another speed. This is a network
simulation running through the backend, not physical offline radio transport.
Packet trace replay slows down observed events for presentation; delay metrics
come from backend simulation time.

## Recording sequence

Click **Play demo** in the top-right corner to run the invitation and reply.
It clears the previous conversation, types into each phone one character at a
time, and waits for verified delivery before starting the reply. The final
conversation stays visible. **Reset demo** stops playback and clears it.

For a separate live terminal ledger, double-click `scripts/packet-ledger.command`
on macOS, or run `npm run demo:ledger` from another terminal. Place that window
beside Chrome for the recording. It follows all six nodes through the same
backend WebSocket and clears when Reset demo resets the simulator. It does not
start duplicate nodes or generate additional traffic.

To run the conversation manually:

1. Show the names, positions, and six online nodes.
2. Send the prepared invitation from Malcome's left phone.
3. Show packets moving through the relays and Basith's receiver verification.
4. Send the prepared reply from Basith's right phone.
5. Show bandwidth, delay, range, packet loss, and the packet ledger.
6. For voice, record up to five seconds, preview, send, and play the verified
   audio on the receiving phone. Chrome microphone permission is required.

For an automated rehearsal, run `npm run demo:record`. It uses the top-right
**Reset demo** button to start a clean conversation, then clicks **Play demo**
and verifies the messages and multi-relay routes. Messages contain no test
timestamps. After saving the delivery
screenshot, the rehearsal checks Reset demo again and leaves both phones empty.
This runs the browser rehearsal; start Loom separately to record it.

Voice uses Codec2 at 1,200 bps on the simulated radio. The backend decodes the
verified receiver bytes into mono 8 kHz WAV for browser playback. Uploaded audio
is limited to the first five seconds. Runtime dependencies include FFmpeg,
`pycodec2`, NumPy, and the native Codec2 shared library (`brew install codec2` on
this Mac). The downloaded WAV is larger than the compressed radio payload.

Use **Reset demo** in the top-right corner for a clean take. It clears both
phones, active transfers, drafts, and the packet ledger while preserving relay
positions and radio settings. The shared preview and Expo services are retired;
only the console on port 5173 and recording backend on port 8003 need to run.

The remote boss → gate → Jordan coding workflow is separate and not part of
this completed meetup scene.

## Optional AI walkthrough

The merged Water AI tab is separate from **Play demo**. Select an internet node,
open **Water AI** on a phone, and ask “What does FAILED mean?” Follow the sealed
question to the gateway and the answer back through the mesh. The default local
mock provider needs no external AI service. Real Nicrron answers and optional
PRISM tracing require explicit configuration; see [README.md](../README.md#water-ai).
This is a question-and-answer workflow, not the proposed Ninoo coding workflow.
