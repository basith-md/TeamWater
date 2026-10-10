# Mobile UI and Expo entry

Implemented `@teamwater/mobile-ui` with a single native `PhoneChat` used by both Expo and the console. The component subscribes to the injected `MeshClient`, maps boss to node0 and employee to node4, filters the two-way conversation, and renders warm off-white/ink/orange chat, sender identity and location, mesh state, chunk progress, send errors, and a composer. The conversation starter populates a draft only; it never sends automatically.

Expo provides role selection, explicit demo replay/live selection, editable HTTP backend settings, and image/audio file selection through `expo-document-picker`. There is no microphone recording control. The default backend is `http://127.0.0.1:8000` for the iOS simulator; physical devices need the computer's LAN address. Native deep links accept `role`, `mode`, and `endpoint` query parameters, for example `teamwater://chat?role=employee&mode=live&endpoint=http%3A%2F%2F192.168.1.20%3A8000` in an installed build. Expo Go accepts the equivalent query parameters on its development URL.

Incoming replay content is hidden until all chunks are received and integrity is verified. Incoming live previews are hidden before any chunk arrives, then explicitly marked unverified and potentially truncated. Only the shared core delivery label can say Delivered, requiring integrity and a terminal receipt. After integration with teammate branch `origin/packet-media-pipeline`, verified received text and images are rendered from the receiver content endpoint; verified voice is offered through an optional native/web `renderAudio(uri)` callback. Native Expo uses `expo-audio` playback controls with loading and codec errors inline. Legacy snapshots without verified content retain the unavailable explanations. Replay media remains explicitly illustrative. Native file selection sends the selected asset URI; Expo web supplies its File object. Embedded browser phones accept the optional `pickMedia(kind)` callback; without a picker they show a clear unavailable explanation.

Failed sends retain drafts, and drafts edited during an in-flight request survive successful completion. A role/mode/endpoint/client session token prevents stale asynchronous send or picker callbacks from clearing a new draft or surfacing an old error.

## TDD evidence

- Before production implementation, `npm test -- packages/mobile-ui/src/PhoneChat.test.tsx` first found the missing module; a null component scaffold then produced **7 behavioral failures** for message visibility, compose/send, draft retention, ACK/receipt status, unavailable media, audio attachment, and in-flight draft editing.
- `npm test -- apps/mobile/src/settings.test.ts` produced **2 assertion failures** against stubs: deep-link settings were ignored and valid HTTP endpoints returned null. Implementing the parser made all 4 settings tests pass.
- `npm test -- apps/mobile/App.test.tsx apps/mobile/src/settings.test.ts` produced **2 App assertion failures** against its null scaffold: role identity and settings were absent. Implementation made both pass.
- Recipient gating and session isolation regression tests were written next. `npm test -- packages/mobile-ui/src/PhoneChat.test.tsx` produced **3 assertion failures**: premature replay content, premature live preview, and stale send error. The fixes made all 10 phone tests pass.
- Final scoped command `npm test -- packages/mobile-ui/src/PhoneChat.test.tsx apps/mobile/App.test.tsx apps/mobile/src/settings.test.ts`: **16 passed**.
- Full `npm test`: **40 passed, 1 skipped** across 6 files at the time of verification. The skipped test is `two independent clients share real FastAPI messages without inventing telemetry or verification` in `tests/integration/live-backend.test.ts`; it requires `TEAMWATER_LIVE_URL`, which was absent from this worker's run.
- `npm run typecheck`: **passed**.

A later `npm test -- --reporter=verbose` during parallel workers' new TDD cycles reported **41 passed, 2 failed, 1 skipped**: core `aborts a stalled request with a recoverable timeout error` timed out, and console `keeps settings keyboard focus in the dialog and restores it on Escape` failed the focus assertion. These results were sent to parent for integration; all 16 mobile tests remained green in that run. The live backend test was still skipped without `TEAMWATER_LIVE_URL`.

The initial invalid-hook failure came from duplicate React versions installed across workspaces; parent unified React/React DOM to 19.2.3 and added Vite deduplication before the green runs. Vite currently prints a non-failing configLoader warning for the root config's module type. Parent confirmed Expo export succeeded for all platforms; simulator interaction remains parent integration work. Component tests use real React Native Web primitives, not DOM-only production components.

## Verified media pipeline integration

Read the branch's `docs/PACKET_MEDIA_HANDOFF.md` and `service/service.py` before integrating. Receiver SHA verification permits content display even if the sender's terminal receipt is pending or lost. Incoming verified messages say **Receiver verified**; outgoing messages continue to use the core's receipt-aware delivery status. This distinction does not claim authenticated or encrypted communication.

Four PhoneChat tests were written first and observed failing for the recipient status distinction, verified live image, verified audio renderer, and missing-player explanation. Three `ReceivedAudio` tests then failed against a null scaffold for play exceptions, native load/codec errors, and playing duration. Implementations made all 23 mobile tests pass. The audio tests substitute only the native player hooks, since the native bridge is unavailable in jsdom; they validate app error/status behavior and do not establish iOS Ogg Opus codec support. Actual native playback requires device verification.

A further unknown-timestamp ordering test failed with the unknown message incorrectly sorted first. The comparator now puts null `createdAt` after known timestamps without fabricating a date.

Final scoped rerun after the timestamp change: **24 passed** across 4 mobile files.
