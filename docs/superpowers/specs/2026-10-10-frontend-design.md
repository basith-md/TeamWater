# TeamWater frontend demo

Build the user's approved demo: boss phone on the left, packet console in the center, employee at Burning Man on the right. One React Native UI runs on Expo iOS/Android and inside the browser stage through React Native Web. Python backend and mesh simulation remain team-owned.

## Architecture

Use npm workspaces: `apps/mobile` (Expo), `apps/console` (Vite/React), `packages/mobile-ui` (native chat UI), `packages/core` (typed transport, state, telemetry). Both clients use normalized interfaces in `packages/core/src/types.ts`, derived from the backend-owned generated wire types in `shared/typescript/api.ts`. Browser stage injects one shared MeshClient into both phones; separate Expo instances connect to the common Python service in live mode. Boss maps to node0; employee maps to node4.

The initial usable view is an explicitly labeled **Demo replay**. It plays deterministic authored packet traces for clear link, packet loss/retry, and relay outage scenarios. It is frontend fixture data, not a replacement mesh simulator and not evidence of network performance. Custom text can be used in the fixture story. Live mode uses real `/ws` snapshots and multipart `/send/text`, `/send/image`, `/send/voice` endpoints. Unknown telemetry is unavailable, never invented. Live HTTP/WS for the console pass through Vite's local proxy to avoid changing the Python service's CORS policy.

## Experience

Warm off-white workspace, black/ink header, orange signal accents, compact typography and a large geographic-style node canvas. Left and right phone cards show messaging, source identity, network state, compose/send, voice/image actions, chunk progress and honest status. Console shows route, packet event ledger, size/airtime-related metrics, latency, range and packet loss. Selecting a message scopes route and trace. Preset controls and playback speed apply only to replay; live controls remain unavailable until the backend implements them. Errors appear inline and retain drafts. Reconnection does not duplicate messages.

Only integrity verified plus terminal receipt confirmed is labeled Delivered. Existing backend `delivered` means chunk ACKs received and is presented as ACK received / verification unavailable. Live recipient preview is explicitly unverified, not reconstructed content. Replay content is clearly sample content. No native codec or simulation work is included.

## Acceptance

- Browser shows both working phone views and console, supports sending/replying and the three trace scenarios.
- Native Expo entry uses the same phone component with role switch and editable backend URL.
- Test-first tests cover progress/delivery truth, malformed snapshots, session reset/reconnect, telemetry unknowns, send errors, replay loss and browser interactions.
- Console production build, TypeScript checks, Expo bundles and unit/integration tests pass; visible browser walkthrough verifies layout and key user paths.
- README documents launch commands, live setup, limitations and the team's telemetry handoff.

## Backend integration update

The shared OpenAPI types landed during implementation at commit `3420fbb` and are consumed directly. The frontend also adapts the `packet-media-pipeline` branch at `0139265` for actual packet traces and recovered verified text/media. These experimental fields remain isolated until added to the published schema. Receiver verification is distinct from sender confirmation. Live range and end-to-end latency remain unavailable pending backend measurements; simulated channel airtime is not labeled latency.
