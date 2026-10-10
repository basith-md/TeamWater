# Frontend execution ledger

Plan: docs/superpowers/plans/2026-10-10-frontend.md
Base: initial `7b52137`, updated to `3420fbb` when the shared OpenAPI types landed.

User authorized parallel agents, TDD, mobile and console implementation. Continue without repeated approval gates. Use existing checkout on feature branch and disjoint file ownership; preserve team backend.

| Interface | Producer | Consumer | Check |
|---|---|---|---|
| shared/typescript/api.ts | Backend team | Core, then both frontends | Canonical generated wire types; untouched |
| types.ts | Core | Mobile/console | Normalized presentation state |
| MeshClient + core helpers | Core | Mobile/console | Exact names supplied to all workers |
| PhoneChat | Mobile | Console | client, role, embedded props |
| npm tooling | Parent | All | Parent exclusively owns lockfile/install |

Tasks 1–4 complete. See the worker reports for observed failing tests followed by passing implementations.

## Initial frontend verification — October 10, 2026

- `TEAMWATER_LIVE_URL=http://127.0.0.1:8000 TEAMWATER_PIPELINE_URL=http://127.0.0.1:8001 npm test`: **79 passed**, 11 files, no skips. Includes two independent clients against main's service, and actual verified full text, events, and counters against the unmodified packet/media branch.
- `npm run typecheck`: passed.
- `npm run build`: passed; console production bundle 344.60 kB JS (110.09 kB gzip).
- `npx expo install --check`: dependencies up to date.
- `npx expo export --platform all`: iOS, Android, and web exports passed after the final core changes.
- Headed Chrome E2E: **5 passed** (send/reply, drop/retry/reset, outage route, narrow viewport, real pipeline). After the final content-error fix, the affected real-pipeline browser test was rerun and passed.
- Visible browser walkthrough showed the three-column console with actual full recovered text and verified delivery. Browser console: zero errors and warnings. Screenshots in `docs/screenshots/`.
- Expo Go loaded the mobile app in the boss iOS simulator and connected to the legacy service. First-run Expo onboarding and the second simulator's launch prompt require a user tap; native send/receive interactions and native Ogg audio playback were not verified. Android was bundle-verified only.

## Review corrections

An independent read-only review identified a stale E2E expectation and a verified-text recovery gap. The test now distinguishes recipient verification from sender delivery. Failed content requests retry at most three times, with session-safe cancellation and explicit exhaustion guidance. A second regression preserves one message's exhausted error when another content request succeeds. Each behavior fix was observed failing before implementation and passing afterward.

## Running locally

Console: `http://localhost:5173`, currently proxying the packet/media branch preview at port 8001. Main's legacy service is at port 8000. Expo Metro is on port 8081. The packet/media preview was extracted to ignored `.superpowers/backend-preview`; no backend, service, OpenAPI, or generated shared files were changed. The committed main branch was not merged with the experimental backend branch.

The frontend is on `feat/expo-mesh-console`. See `FRONTEND.md` for reproducible startup and the backend handoff document for remaining telemetry fields. The voice, trace and shared-contract follow-up is described below.

## Voice, trace and OpenAPI 1.1 follow-up

- Microphone recording in browser and Expo: five-second limit, preview/send/discard, failure retry, background/session/permission-race cleanup. Incoming messages say Receiving, including honest failed/cancelled states.
- Live simulation defaults in the console; sample replay is explicitly separate. The map reads Simulated Mesh Network, uses Alex/Jordan identities, and plays queued observed transmissions with independent delivery status.
- Synced the backend team's OpenAPI 1.1 and generator from `packet-media-pipeline` commit `554957a`; regenerated shared Python and TypeScript using pinned generators. Both generated outputs match that published commit. No backend implementation changes were made.
- Fresh full verification: **128 tests passed**, 15 files, including legacy service, newest pipeline text/metrics, and genuine five-second Opus encode/transfer/decode/receipt. Typecheck passed.
- **6 headed Chrome E2E tests passed**, including actual SVG packet movement and browser microphone capture (synthetic device) → backend → verified playable recipient audio. This does not establish physical device microphone or speaker behavior.
- Console production build passed. Expo iOS, Android and web exports passed; the published EAS update performs a fresh native bundle export.
- Independent review found cancellation, permission-dialog and stale-timer edges; each was corrected with regression tests. No remaining material review findings.
- EAS project: `ravejedii/teamwater`, SDK 57, preview environment with phone-reachable HTTPS backend. Current backend is the unmodified latest teammate preview on port 8001 through a temporary tunnel; the Mac/service/tunnel must remain running.

A newly requested Jordan Code workspace and sponsor integration are a subsequent task; they are not included in the above verification counts.
