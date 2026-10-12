# Phone UI and packet console

The current demo runs locally in `apps/console`: Malcome's phone on the left, the simulated mesh and ledger in the center, and Basith's phone on the right. Malcome is at Mayan Warrior in deep playa; Basith is at the playa airport. Lucas, Shravanthi, Dave, and Frank relay traffic. The recording topology spans 2.8 km and requires at least four hops between the phones.

`packages/mobile-ui` provides the shared React Native phone components. `packages/core` owns HTTP/WebSocket transport, state normalization, and telemetry. API adapters consume generated types from `shared/typescript/api.ts`, which is generated from OpenAPI 1.3. Change the schema and run `./generate-types.sh` to update the shared contract.

## Local recording demo

Follow the setup commands in [README.md](README.md) and the [recording guide](docs/RECORDING.md). The console is at http://localhost:5173, with the backend on port 8003. Set `TEAMWATER_BACKEND_URL=http://127.0.0.1:8003` when starting Vite; its `/api` and `/connect` proxies otherwise target port 8000. WebSocket traffic uses the same backend.

There is one simulator mode in the console. **Play demo** resets the conversation, types each message character by character, and waits for delivery before replying. **Reset demo** stops playback and clears the conversation, drafts, transfers, and ledger. There are no preloaded conversation messages.

The graph uses backend node positions and connectivity. The small packet marker repeats a leg slowly while that transmission remains active, then advances when observed events confirm progress. Live status, routes, and metrics come from the same snapshots and events as the ledger. **Replay trace** allows inspection of observed history; its visual pacing is separate from the backend timestamps used for latency. Node dragging and routing controls change the real simulated topology.

The multiline composer grows with its text. In the phone UI, incoming progress is labeled receiving. Sender **Delivered** requires destination verification and a terminal receipt; the receiver can have verified content while the sender still awaits that receipt. Missing measurements are unavailable, not zero.

## Voice and media

**Record voice** asks for microphone permission, records up to five seconds, then offers playback, send, and discard. Failed uploads retain the clip for retry. Browser recording needs HTTPS or localhost. Image and audio file pickers use the same mesh transport.

The current backend encodes voice with Codec2 at 1,200 bps and returns verified receiver audio as mono 8 kHz WAV. FFmpeg and the native Codec2 library are required. Rendered text, images, and audio come from verified recovered content, not the sender's preview. See the recording guide for installation and testing.

## Water AI

The console phones offer a **Water AI** tab alongside Chat. Choose the internet node in the console, select a model, and ask a question of at most 400 UTF-8 bytes. Request stages show waiting for a gateway, transmitting the question, provider work, returning the answer, and completion or failure. AI packet transfers also appear in the mesh and ledger.

The setup link follows the configured backend endpoint. Request and model-list responses are scoped to that endpoint/session; switching endpoints or resetting cannot restore stale AI content. AI input and controls are disabled during scripted playback and reset. A submitted response does not clear a newer draft.

The default provider is a local mock. See [Water AI configuration and data handling](README.md#water-ai) before enabling Nicrron or PRISM. The optional AI workflow is independent of the Malcome/Basith meetup script. It answers questions; it does not implement Ninoo code generation, PR creation, or app deployment.

## Retained mobile and coding-workspace source

`apps/mobile` retains the Expo client, and `apps/team-preview` retains the retired preview source. There is no active hosted team preview or Expo service required for this demo. Native clients cannot use Vite's relative `/api` proxy: they need a reachable backend URL configured in their settings. Do not reuse old published links as a launch path for this local version.

If native development resumes, verify current official App Store and Google Play Expo Go compatibility before changing the pinned SDK or publishing. Align dependencies, run Expo checks and both platform exports, and test the actual phones before sharing a launch link. Browser verification does not establish physical-device microphone or keyboard behavior.

`CodeWorkspace` and `JordanWorkspace` remain separate components with tests. They are not wired into the recording demo and do not execute Ninoo workflows.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

These cover transport/session behavior, sender and receiver status, draft preservation, AI controls, and playback/reset. Live-backend integration tests require a separately running service:

```sh
TEAMWATER_PIPELINE_URL=http://127.0.0.1:8003 npm run test:pipeline
npm run demo:record
```

Browser rehearsals run visibly. The local demo backend should be stopped after the session if no longer needed.
