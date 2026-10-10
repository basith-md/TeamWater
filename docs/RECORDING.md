# Playa meetup recording

Open http://localhost:5173 in Chrome. The console has one live simulator mode.

Malcome is at Mayan Warrior in deep playa. Basith is at the playa airport.
Lucas, Shravanthi, Dave, and Frank are other participants relaying messages.
All six nodes are online. The starting shortest route is
Malcome → Lucas → Basith; the simulator computes it from the team’s distributed
node positions and 180 m radio range. Shravanthi, Dave, and Frank provide other
connected routes. A relay does not need to appear on every selected route.

## Start

From the repository root, use two terminals:

```sh
.venv/bin/python -m uvicorn deployment.playa_demo:app --host 127.0.0.1 --port 8003
```

```sh
TEAMWATER_BACKEND_URL=http://127.0.0.1:8003 npm run dev --workspace @teamwater/console -- --port 5173 --strictPort
```

The recording wrapper only configures the team's mesh engine. It uses 20% packet
loss, 1,070 bps, per-hop retries, and 20× simulation playback. This is a network
simulation running through the backend, not physical offline radio transport.
Packet trace replay slows down observed events for presentation; delay metrics
come from backend simulation time.

## Recording sequence

1. Show the names, positions, and six online nodes.
2. Send the prepared invitation from Malcome's left phone.
3. Show packets moving through the relays and Basith's receiver verification.
4. Send the prepared reply from Basith's right phone.
5. Show bandwidth, delay, range, packet loss, and the packet ledger.
6. For voice, record up to five seconds, preview, send, and play the verified
   audio on the receiving phone. Chrome microphone permission is required.

Restart only the port 8003 process and reload the console for a clean take.
The backend's general `/simulation/reset` restores its default topology, so it
is not the recording reset. The shared preview and Expo services are retired;
only the console on port 5173 and recording backend on port 8003 need to run.

The remote boss → gate → Jordan coding workflow is separate and not part of
this completed meetup scene.
