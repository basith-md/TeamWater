# Voice acceptance and current native compatibility

Only the new integration test and this report were added for voice verification. No backend, app, native codec, or core production change was needed for this test.

## Real pipeline acceptance

Command: `TEAMWATER_PIPELINE_URL=http://127.0.0.1:8001 npm test -- tests/integration/voice-backend.test.ts`

Result: **1 passed**, 95.88 seconds, against the parent's running unmodified packet/media branch service with actual 20% per-hop packet loss and retries.

The test creates a 5.5 second, 16 kHz mono PCM WAV tone in memory, sends it through the real shared `MeshClient.sendMedia`, waits for receiver integrity verification, fetches the safe receiver content URL, verifies `audio/ogg`, `OggS` and `OpusHead`, and decodes the received content through local FFmpeg. It checks 4.95–5.05 seconds of non-silent decoded PCM, proving the backend's first-five-seconds policy and genuine audio decoding rather than a plausible header alone. It then requires the sender terminal receipt and **Delivered** label.

Observed message `b78dd2d6-f614-4c12-85c6-e9c08dde62c2`: original WAV 176044 bytes, received Opus/Ogg 3452 bytes, transfer envelope 3732 bytes, 19 chunks, cumulative radio bytes 88486, 103 lost hop transmissions, 103 retry attempts, receiver verified, terminal delivered. This is one actual simulated-backend transfer; it does not establish speech intelligibility or physical radio performance.

The test is opt-in via `TEAMWATER_PIPELINE_URL`, uses no microphone, and requires local FFmpeg for real decode verification. Backend encoding independently requires FFmpeg/libopus. No forced RED was performed because this is an acceptance test of existing behavior, not a production feature change.

## Current playback evidence

- Installed `expo-audio` 57.0.5 uses `AVURLAsset` → `AVPlayerItem` → `AVQueuePlayer` in `node_modules/expo-audio/ios/AudioUtils.swift`. Its recording presets use MPEG-4 AAC/M4A on iOS. Current [Expo Audio documentation](https://docs.expo.dev/versions/latest/sdk/audio/) lists Expo Go support and delegates supported native media formats to Apple.
- Apple's [Safari 18.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes) and the [WebKit 18.4 announcement](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) document Ogg/Opus and Ogg/Vorbis support on iOS 18.4 and later. That is browser/platform evidence; it alone is not a physical Expo app playback test.
- A current primary [WebKit AVFoundation change](https://github.com/WebKit/WebKit/commit/6792010dc8f962e42f3ee5cf9eb82bd9c8ed7a2b) discusses Ogg MIME handling. Its actual iOS test exclusion says Ogg is unavailable **in the simulator**, so an older simulator failure cannot by itself establish that current physical iPhones reject Ogg.
- A standalone Swift AVFoundation probe ran on macOS 26.6.2: Ogg MIME support was present and `AVURLAsset.isPlayableExtendedMIMEType("audio/ogg; codecs=opus")` returned true.
- The same probe was compiled for and executed inside the already-running TeamWater Boss iOS 26.5 simulator. It reported Ogg MIME support and Opus/Ogg MIME playable=true. Loading the actual verified receiver content URL returned `asset.load(.isPlayable) == true`. Its streaming duration returned NaN, so this probe does not establish correct timeline metadata or audible output. No actual speaker playback was initiated.

The present runtime evidence does not indicate a codec change is needed for current iOS. Physical Expo Go microphone recording, native URI multipart upload, and audible receiver playback remain device acceptance steps. No claim is made that those have been completed. If an older target phone or an actual device fails Ogg playback, coordinate a receiver-side compatible render (such as AAC/M4A) with the backend team after integrity verification; do not silently change transported bytes, pretend browser playback proves native playback, or add a native decoder that Expo Go cannot load.

## Follow-up acceptance

The same real voice acceptance test also passed against the team’s updated `554957a` backend as part of the parent’s 128-test suite. Headed Chrome additionally captured a synthetic microphone clip through the actual MediaRecorder UI, sent it over the live mesh backend, and verified that the receiver’s audio element advanced playback without a media error. Physical Expo Go recording and audible phone playback remain unverified.
