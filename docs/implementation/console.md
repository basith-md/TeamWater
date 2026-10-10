# Console stage implementation

Implemented Task 3 of the approved frontend plan in `apps/console`. The browser creates one mesh client and injects it into both shared React Native Web phone views and the console. No backend/service files or root dependency tooling were changed by this worker.

## Experience and behavior

- Ink CHRP/TeamWater header, warm ivory workspace, orange signal accents, two bordered phone views, and a technical grid topology drawn from client nodes/links.
- Boss phone on the left; employee at Burning Man on the right. Below 1050px the console leads with phones side by side; below 620px each phone stacks at a usable full width.
- `Demo replay` and `Live backend` controls. Replay scenario, speed, and `Reset demo` work through the shared client and disable in live mode. Presets are Clear link, Packet loss & retry, and Relay outage.
- Message selection scopes topology highlighting, route, latency/loss metrics, and the packet ledger. The latest message is selected automatically until a specific message is inspected. Reset clears the selection with the client trace.
- Actual packet transmit/receive events animate their reported hop. The topology is labeled not to scale. No live packet events are fabricated when the backend lacks event telemetry.
- Live ledger time is simulation time (`+1.250s`, **Sim time**), not a wall-clock date. Replay uses elapsed time from its selected message. Unknown replay creation time stays `—`; unknown-time messages sort after known messages, including a valid zero timestamp. Unknown packet byte counts also show `—`. Backend no-route events appear explicitly as **No route**.
- Four metrics preserve null values as **Unavailable**. Bandwidth and range are labeled configuration values. Packet loss derives from observed events; delay derives from completed message timing. Replay values are explicitly fixture configuration, not measured network performance.
- Delivery wording comes from core's integrity/receipt-aware `deliveryLabel`. An ACK-only live message does not become Delivered.
- Connection settings allow `/api` or a service URL. The settings dialog focuses its input, contains Tab navigation, closes on Escape, and restores focus to its trigger.
- Both phones receive a browser file picker callback for actual image/audio files. The picker passes the selected `File`, filename, MIME type, and data URI to the shared component. Cancel resolves with no asset and removes the picker. The teammate backend's verified voice content uses browser `<audio controls>` through the shared component's optional renderer. Playback errors offer the same verified file as a download; failure state does not carry into a different file. The shared component gates the renderer on verified live content. Replay media remains illustrative.

Vite aliases `react-native` to `react-native-web`, deduplicates React/React DOM, and proxies HTTP/WebSocket `/api` to `TEAMWATER_BACKEND_URL` (default `http://127.0.0.1:8000`), stripping the `/api` prefix. Thus `/api/ws` forwards to `/ws`. Absolute cross-origin endpoints need the service to allow the console origin; the default local proxy requires no backend CORS changes.

## Test-first evidence

Tests use the real console and mobile component with a complete observable fake client for deterministic state/control boundaries. Core runtime and telemetry imports are real; no component mocks remain.

1. **RED, 12:52:** `node_modules/.bin/vitest run apps/console/src/App.test.tsx` — 4 failures against an empty App. Missing metric groups, replay controls, inspect-message buttons, and reset behavior failed with expected accessible element assertions. Repeated RED at 12:53 after aligning E2E control names with integration.
2. **GREEN, 12:57:** `node_modules/.bin/vitest run apps/console/src/App.test.tsx --testTimeout=20000` — 4/4 passed. The first green attempt had 2 default 5s timeout failures while simultaneous Expo compilation occupied the machine. No implementation changes were made to obtain the diagnostic green run.
3. **RED, 12:59:** added keyboard-dialog regression — 4 passed, 1 failed because focus stayed on the settings trigger outside the dialog.
4. **GREEN, 13:00:** same scoped command — 5/5 passed after focus/Escape handling.
5. **RED, 13:00:** `node_modules/.bin/vitest run apps/console/src/browserMedia.test.ts` — 2 failures because the empty picker did not create an input.
6. **GREEN, 13:01:** `node_modules/.bin/vitest run apps/console/src/browserMedia.test.ts apps/console/src/App.test.tsx` — 7/7 passed with the normal timeout.
7. **RED, 13:03:** audio controls/error fallback tests and missing packet byte-count regression — 3 expected failures (no player and empty byte cell). Implemented verified browser audio and `—` for null bytes.
8. **RED, 13:04:** stale audio-error regression failed after switching media URI. No-route ledger regression failed because its event label was blank. Fixed failure scoping and added No route presentation.
9. **GREEN, 13:05:** `node_modules/.bin/vitest run apps/console/src --testTimeout=20000` — 12/12 passed.
10. **RED, 13:06:** live simulation-time, replay elapsed-time, and unavailable replay-time checks failed against wall-clock formatting. A focused `-t 'latest known-time'` run at 13:07 also caught null creation time incorrectly sorting ahead of a valid zero timestamp.
11. **GREEN, 13:07:** `node_modules/.bin/vitest run apps/console/src --testTimeout=20000` — 16/16 passed after timestamp formatting and null-aware ordering.

The already-running full `npm test` at 13:00 completed with **43 passed, 1 skipped** across **6 passed files, 1 skipped file**. This predates the two picker tests; parent owns the final coordinated full suite after all workers finish.

Final worker verification:

- `npm run typecheck` — exit 0.
- `npm run build --workspace @teamwater/console` — exit 0, Vite 8.3.4; JS 341.05 kB / 108.96 kB gzip, CSS 17.29 kB / 4.64 kB gzip.
- Scoped console, picker, and verified audio tests — 16 passed.

Native visible browser walkthrough and browser E2E verification are owned by the integrating parent, not claimed by this worker.

## Boundaries and limitations

Replay is authored sample content and packet traces, not a mesh simulator. Live tuning is disabled until the shared client exposes supported controls. Live packet telemetry and verified media use backend capabilities when supplied; original ACK-only snapshots retain unavailable verification and telemetry. Voice selection is an audio-file attachment, not microphone recording. Rendering is intentionally shared with the Expo component.

No new dependencies, subagents, or commits were created by the console worker.
