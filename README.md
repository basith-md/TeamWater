# Water Connect

A local mesh-network simulator, React phone UI, packet console, and optional AI gateway. The recording demo follows Malcome inviting Basith from the playa airport to Mayan Warrior in deep playa. Six simulated nodes run in one Python process; messages cross at least four radio hops in the recording topology.

The demo runs locally. The former shared preview is retired. Expo source remains in the repository but is not needed for the browser demo.

## Run locally

Use Python 3.11+ and Node.js 22.22+. From the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
```

Start the recording backend in one terminal:

```sh
env -u PYTHONPATH AI_PROVIDER=mock PRISM_API_KEY= PRISM_PROJECT_ID= .venv/bin/python -m uvicorn deployment.playa_demo:app --host 127.0.0.1 --port 8003
```

Start the console in another:

```sh
TEAMWATER_BACKEND_URL=http://127.0.0.1:8003 npm run dev -- --port 5173 --strictPort
```

On Windows, npm drops the `--port` flag; run Vite directly from `apps/console` instead: `TEAMWATER_BACKEND_URL=http://127.0.0.1:8003 ../../node_modules/.bin/vite --port 5173 --strictPort`, and use `.venv/Scripts/python` in place of `.venv/bin/python`.

Open http://localhost:5173. **Play demo** clears the conversation, types the invitation and reply character by character, and waits for verified delivery. **Reset demo** clears phones, transfers, and the ledger while preserving node positions and radio settings. Stop each process with Ctrl+C when finished.

For a separate terminal view of the same packet events, run `npm run demo:ledger`. It observes the existing backend; it does not start more nodes. See [recording instructions](docs/RECORDING.md) for the route, controls, and voice requirements.

Text works without media tools. Voice uses Codec2 at 1,200 bps and decodes to WAV at the receiver. It requires FFmpeg and the Codec2 shared library in addition to the Python requirements (`brew install ffmpeg codec2` on macOS). Recordings are limited to five seconds. This is a software network simulation, not a physical radio implementation.

## Water AI

Each console phone has **Chat** and **Water AI** tabs. Select an **Internet node**, then ask a short question such as “What does FAILED mean?” The question is sealed, transmitted over the mesh to the gateway, answered through Water Connect, and sent back over the mesh. The console shows request stages and the actual packet transfers. With no reachable internet node, requests wait for one.

The default `AI_PROVIDER=mock` uses a local test provider. It proves the transport and UI flow without calling a real model. For real answers, copy `connect/.env.example` to `connect/.env`, set `AI_PROVIDER=nicrron` and `NICRRON_API_KEY`, and restart the backend without the `AI_PROVIDER=mock` override above. The file documents optional PRISM tracing, evaluation, and knowledge-base settings. Remove the blank PRISM environment overrides only when you intend to enable that integration.

The setup portal is at http://localhost:5173/connect. Local demo mode seeds one shared account (`team@water.demo`, password `teamwater`) and enrolls the six simulated phones. Keep demo mode local. With `WATER_DEMO=0`, startup requires a private `WATER_SESSION_SECRET` and `WATER_MASTER_KEY`. Generate them separately and save them in the ignored `connect/.env` file:

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
python3 -c 'import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'
```

The first value is the session secret; the second is the master key. Keep the master key stable so previously enrolled device keys remain readable.

Relay API responses contain sealed answers and non-plaintext metadata. Water Connect decrypts requests to call the provider, and authorized group members can view questions and answers in its trust log. Configured PRISM tracing also receives that content. The local simulator holds every simulated device's state and keys; it is not a security boundary between real phones. Reset cancels the local AI workflow but cannot undo a provider call that has already started.

Grounded replies include field-guide sources; uncovered questions may receive a labeled general answer when `REQUIRE_GROUNDING=0`. Set it to `1` for field-guide-only replies. Budgets count actual provider calls, including a fallback call. Retries reuse request IDs to retrieve cached answers. To publish local reference facts to a configured PRISM knowledge base, run `.venv/bin/python -m connect.kb_sync`. This replaces matching field-guide documents; removing a local fact does not automatically delete its remote copy.

## Hosted demo

The console can be hosted separately from the simulator, for example the console on Vercel and the backend on Render (see [`render.yaml`](render.yaml) and [RENDER.md](RENDER.md)).

- **Console:** build `apps/console` with `VITE_BACKEND_URL` set to the backend's public URL, such as `https://your-service.onrender.com`. Without it, the console uses the local `/api` proxy.
- **Backend:** set `CORS_ORIGINS` to the console's origin, such as `https://your-console.vercel.app`. Separate multiple origins with commas. Unset, the service stays same-origin only.

Free hosts sleep when idle and take 30–60 seconds to wake. While the backend is unreachable, the console shows a wake screen with a progress bar. It keeps pinging the backend and connects as soon as it answers.

## Shippable phone module

[`shippable/`](shippable/) holds the code meant for real phones: [`shippable/water-ai`](shippable/water-ai/) is the phone side of Water AI (setup, sealed questions over the mesh, gateway relay), byte-compatible with Water Connect in [`connect/`](connect/). Start with [`shippable/README.md`](shippable/README.md).

## Repository and shared contracts

| Path | Responsibility |
| --- | --- |
| `backend/` | Mesh routing, packet transport, media codecs, receiver verification |
| `service/` | HTTP/WebSocket API and mesh-to-AI gateway |
| `connect/` | Enrollment, groups, signed relay API, provider calls, budgets, trust log |
| `deployment/playa_demo.py` | Local recording topology and node identities |
| `apps/console/` | Two phones, live topology, metrics, packet ledger, demo playback |
| `apps/mobile/` | Retained Expo client |
| `packages/core/` | Shared state, API client, telemetry and contract adapters |
| `packages/mobile-ui/` | Shared chat, recording, and AI UI |

`openapi.yaml` is the contract source of truth (version 1.3), including AI controls, state, and Connect JSON APIs. Edit it and regenerate both languages:

```sh
./generate-types.sh
```

Do not edit `shared/python/models.py` or `shared/typescript/api.ts` directly. See [the generated-file rule](shared/DO_NOT_EDIT.md), [frontend notes](FRONTEND.md), and [packet/media details](docs/PACKET_MEDIA_HANDOFF.md).

## Verify

```sh
env -u PYTHONPATH AI_PROVIDER=mock PRISM_API_KEY= PRISM_PROJECT_ID= .venv/bin/python -m unittest discover -s tests
npm test
npm run typecheck
npm run build
```

The AI tests use temporary databases and mocked providers. They do not verify real Nicrron credentials, model availability, or PRISM delivery. Optional live-service frontend tests are skipped unless their backend URL is configured. With the local demo running, `npm run demo:record` rehearses Play/Reset in a visible browser; start Loom separately to record it.
