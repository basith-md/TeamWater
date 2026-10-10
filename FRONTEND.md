# Mobile app and packet console

The frontend has two entry points and one shared phone UI:

- `apps/mobile`: Expo app for iOS, Android and web. Select Boss or Employee in the app settings.
- `apps/console`: browser stage with the boss phone on the left, mesh inspector in the center and employee phone on the right.
- `packages/mobile-ui`: the React Native phone component used by both entry points.
- `packages/core`: state, HTTP/WebSocket transport, deterministic frontend replay fixtures and telemetry selectors.

The live adapter imports `components` and `operations` directly from the backend team's generated `shared/typescript/api.ts`. The generated files remain unchanged. Experimental fields from `packet-media-pipeline` are isolated from that base contract until the team publishes them in OpenAPI.

The boss maps to `node0`; the employee at Burning Man maps to `node4`. These are presentation identities; the current backend still calls those nodes Alice and Eve.

## Start the browser demo

Requires Node.js 22.22 or later and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:5173. The initial **Demo replay** mode works without Python. Type in either phone, choose a replay scenario, and watch its authored packet trace. The phones share the same client, so replies appear on the other side. Replay fixtures are for frontend development and presentation; their timings and metrics are not measurements of the team's mesh simulator.

## Connect to the Python backend

From the repo root, in a separate terminal:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python service/service.py
```

Switch the console to **Live backend**. Use `/api` for the local Vite proxy; it forwards HTTP and WebSocket requests to `http://127.0.0.1:8000`. The proxy runs only in the development server. A production deployment needs the same reverse proxy or explicit backend CORS support.

The frontend supports both the service on `main` and the newer `packet-media-pipeline` branch. Main reports aggregate progress and the latest route; the branch adds real packet events, verification, recovered content, and radio-byte counters. Range and end-to-end delay remain unavailable in live mode because neither service publishes those measurements. See [the integration contract](docs/frontend-backend-contract.md).

To point the development proxy at a different running backend, restart Vite with its URL:

```sh
TEAMWATER_BACKEND_URL=http://127.0.0.1:8001 npm run dev
```

## Run Expo

```sh
npm run mobile
```

Use Expo's `i` key to open iOS, `a` for Android, or run `npm run mobile:web` for the web entry. Two simulators can open the same Metro URL. Select Boss on one and Employee on the other; select Live backend on both so they share the same Python process.

Use `http://127.0.0.1:8000` from iOS Simulator, `http://10.0.2.2:8000` from an Android emulator, or the computer's LAN IP from a physical phone. A phone's own `localhost` is not the computer. The endpoint can be edited in app settings. Separate Expo clients in replay mode each have their own independent fixture session.

Image and audio selection uses the system document picker; the browser console also supports file selection. On `packet-media-pipeline`, verified images render from the recovered content endpoint, and audio uses browser controls or `expo-audio` in native clients. Playback errors are shown inline. Actual Ogg/Opus playback in iOS remains device/codec dependent and has not been verified. Main's older service does not provide recovered media content, so the UI labels it unavailable.

Launch links can select each phone's role and endpoint, for example `exp://127.0.0.1:8081/--/?role=employee&mode=live&endpoint=http%3A%2F%2F127.0.0.1%3A8001`. Select Boss/Playa in the app to change roles without restarting.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run test:live # requires main's Python service on port 8000
TEAMWATER_PIPELINE_URL=http://127.0.0.1:8001 npm run test:pipeline
cd apps/mobile
npx expo install --check
npx expo export --platform all
```

Browser tests use a visible Chrome window. The test suite covers message routing, failed-send drafts, partial and ACK-only states, verified receipt gates, replay drops/retries, endpoint changes and unavailable telemetry. TDD observations are recorded in `docs/implementation/`.

## Delivery wording

`Delivered` requires destination integrity verification **and** a terminal receipt at the sender. Main's `delivered` field only confirms chunk ACKs; the frontend displays **ACK received** and explicitly says verification is unavailable. With the newer branch, the receiver can read verified content while the sender still shows **receipt pending** or **receipt unconfirmed**. Full text is fetched from the recovered content endpoint, never reconstructed from its truncated preview. Missing measurements are displayed as unavailable rather than zero.
