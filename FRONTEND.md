# Mobile app and packet console

The frontend has two entry points and one shared phone UI:

- `apps/mobile`: Expo app for iOS, Android and web. Select Boss or Employee in the app settings.
- `apps/console`: browser stage with the boss phone on the left, mesh inspector in the center and employee phone on the right.
- `packages/mobile-ui`: the React Native phone component used by both entry points.
- `packages/core`: state, HTTP/WebSocket transport, deterministic frontend replay fixtures and telemetry selectors.

The live adapter imports `components` and `operations` directly from the backend team's generated `shared/typescript/api.ts`. The generated files remain unchanged. The OpenAPI 1.1 schema and regenerated Python/TypeScript models are synchronized from the team’s `packet-media-pipeline` commit `554957a`; the frontend consumes those published fields directly and retains compatibility with older snapshots.

The boss maps to `node0`; the employee at Burning Man maps to `node4`. These are presentation identities; the current backend still calls those nodes Alice and Eve.

## Start the browser demo

Requires Node.js 22.22 or later and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:5173. **Live simulation** is the default: messages travel through the running Python mesh simulator. **Sample replay** works without Python and plays authored examples of clear links, losses and relay outages. Its timings and metrics are sample data. Both views are labeled **Simulated Mesh Network**; the mode describes the source of the data.

The console queues observed packet transmissions into a readable hop animation. Animation speed is presentation timing; the ledger retains backend simulation timestamps and delivery status updates immediately. Use **Replay trace** to inspect an observed trace again. The animation queue is bounded to 200 hops and discloses any overflow.

## Connect to the Python backend

From the repo root, in a separate terminal:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python service/service.py
```

Leave the console in **Live simulation**. Use `/api` for the local Vite proxy; it forwards HTTP and WebSocket requests to `http://127.0.0.1:8000`. The proxy runs only in the development server. A production deployment needs the same reverse proxy or explicit backend CORS support.

The frontend supports both the service on `main` and the newer `packet-media-pipeline` branch. Main reports aggregate progress and the latest route; the branch adds real packet events, verification, recovered content, and radio-byte counters. The latest branch reports configured radio range, packet loss counters, and delay to receiver verification. Older service versions omit these measurements and the UI explains each unavailable value. See [the integration contract](docs/frontend-backend-contract.md).

To point the development proxy at a different running backend, restart Vite with its URL:

```sh
TEAMWATER_BACKEND_URL=http://127.0.0.1:8001 npm run dev
```

## Run Expo

```sh
npm run mobile
```

Use Expo's `i` key to open iOS, `a` for Android, or run `npm run mobile:web` for the web entry. Two simulators can open the same Metro URL. Select Boss on one and Employee on the other; select Live simulation on both so they share the same Python process.

Use `http://127.0.0.1:8000` from iOS Simulator, `http://10.0.2.2:8000` from an Android emulator, or the computer's LAN IP from a physical phone. A phone's own `localhost` is not the computer. The endpoint can be edited in app settings. Separate Expo clients in replay mode each have their own independent fixture session.

**Record voice** asks for microphone permission, records up to five seconds, then offers playback, Send voice and Discard. A failed upload retains the clip for retry. Changing phone/session or backgrounding an active recording cancels it. Browser recording requires HTTPS or localhost. Image and audio file selection also uses the system document picker; the browser console supports file selection. On `packet-media-pipeline`, verified images render from the recovered content endpoint, and audio uses browser controls or `expo-audio` in native clients. Playback errors are shown inline. A generated recording was transported through the real packet/media backend, verified and decoded as five-second Ogg/Opus audio. The iOS 26.5 simulator reports the recovered stream playable through AVFoundation; physical iPhone/Android microphone and speaker behavior still requires device testing. See [voice verification](docs/implementation/voice.md). Main's older service does not provide recovered media content, so the UI labels it unavailable.

Launch links can select each phone's role and endpoint, for example `exp://127.0.0.1:8081/--/?role=employee&mode=live&endpoint=http%3A%2F%2F127.0.0.1%3A8001`. Select Boss/Playa in the app to change roles without restarting.

## Expo Go on iPhone and Android

The EAS project is [ravejedii/teamwater](https://expo.dev/accounts/ravejedii/projects/teamwater). The voice/mesh preview was published from commit `1648c05` for both iOS and Android. Share the [teammate preview launcher](https://expo.dev/preview/update?message=Voice+recording%2C+readable+mesh+traces%2C+and+shared+OpenAPI+1.1+metrics&updateRuntimeVersion=exposdk%3A57.0.0&createdAt=2026-10-10T17%3A39%3A07.334Z&slug=exp&projectId=12bc6cfe-8f05-43f8-8381-14401575cff8&group=ae210d34-d674-44c1-a662-26777c353814), then choose **Expo Go**. The account dashboard URL is an administrative update page, not an app launcher. Expo's Expo Go preview webpage may require Expo sign-in.

With compatible Expo Go already installed, [open the app directly](exp://u.expo.dev/12bc6cfe-8f05-43f8-8381-14401575cff8/group/ae210d34-d674-44c1-a662-26777c353814), or [scan the Expo Go QR code](https://qr.expo.dev/eas-update?projectId=12bc6cfe-8f05-43f8-8381-14401575cff8&groupId=ae210d34-d674-44c1-a662-26777c353814) from another screen. Some chat browsers do not open `exp://` links; use the HTTPS preview launcher in Safari or Chrome in that case. Use SDK 57-compatible Expo Go on both devices. The published preview uses `EXPO_PUBLIC_BACKEND_URL` from the EAS **preview** environment and starts in live mode. Choose **Boss / node0** on one phone and **Playa / node4** on the other. These are two shared demo identities, not individual teammate accounts.

The current preview backend runs on the development Mac through a temporary HTTPS Cloudflare tunnel. The Mac, Python service and tunnel must remain running. If that tunnel is replaced, update the public backend URL in EAS and publish again, or enter the replacement URL in the app's Settings. This is a device-testing setup, not a permanent backend deployment. No backend credentials are embedded in the app.

To publish an update from `apps/mobile`:

```sh
npx eas-cli update --branch preview --environment preview --platform all --message "Describe the change"
```

For local development, copy `apps/mobile/.env.example` to `.env.local`, set `EXPO_PUBLIC_BACKEND_URL` to a phone-reachable backend, then run `npm run mobile` from the root. Without a valid configured URL, a local Expo session starts in sample replay. The console's local `/api` proxy is not available to native phones.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run test:live # requires main's Python service on port 8000
TEAMWATER_PIPELINE_URL=http://127.0.0.1:8001 npm run test:pipeline
# Real five-second voice transfer (~2 minutes):
TEAMWATER_PIPELINE_URL=http://127.0.0.1:8001 npx vitest run tests/integration/voice-backend.test.ts
cd apps/mobile
npx expo install --check
npx expo export --platform all
```

Browser tests use a visible Chrome window. The test suite covers message routing, failed-send drafts, partial and ACK-only states, verified receipt gates, replay drops/retries, endpoint changes and unavailable telemetry. TDD observations are recorded in `docs/implementation/`.

## Delivery wording

`Delivered` requires destination integrity verification **and** a terminal receipt at the sender. Main's `delivered` field only confirms chunk ACKs; the frontend displays **ACK received** and explicitly says verification is unavailable. With the newer branch, the receiver can read verified content while the sender still shows **receipt pending** or **receipt unconfirmed**. Full text is fetched from the recovered content endpoint, never reconstructed from its truncated preview. Missing measurements are displayed as unavailable rather than zero.
