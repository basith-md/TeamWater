// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { createMeshClient, deliveryLabel, deriveTelemetry } from '@teamwater/core';
import type { MeshClient, MeshState } from '@teamwater/core';

function waitFor(client: MeshClient, predicate: (state: MeshState) => boolean, milliseconds = 180_000) {
  return new Promise<MeshState>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`Voice transfer timed out: ${client.getSnapshot().error ?? 'no client error'}`)); }, milliseconds);
    const check = () => {
      const state = client.getSnapshot();
      if (predicate(state)) { clearTimeout(timer); off(); resolve(state); }
    };
    const off = client.subscribe(check); check();
  });
}

/** 5.5 seconds of PCM tone tests the backend's first-five-seconds policy without a microphone. */
function waveFixture(): Uint8Array<ArrayBuffer> {
  const samples = 88_000; // 5.5 seconds at 16 kHz
  const bytes = new Uint8Array(44 + samples * 2);
  const header = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); header.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, 16_000, true); header.setUint32(28, 32_000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  text(36, 'data'); header.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) header.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * 440 / 16_000) * 10_000), true);
  return bytes;
}

test.runIf(Boolean(process.env.TEAMWATER_PIPELINE_URL))('real voice upload is receiver-verified Ogg/Opus, decodes to five seconds, and has a terminal receipt', async () => {
  const endpoint = process.env.TEAMWATER_PIPELINE_URL!;
  const client = createMeshClient({ mode: 'live', endpoint });
  try {
    client.start(); await waitFor(client, state => state.nodes.length === 6, 10_000);
    const file = new Blob([waveFixture()], { type: 'audio/wav' });
    const id = await client.sendMedia('node0', 'node4', 'voice', { uri: '', name: 'synthetic-five-second-voice.wav', type: 'audio/wav', file });
    const verified = await waitFor(client, state => state.messages[id]?.integrity === 'verified' && Boolean(state.messages[id]?.mediaUrl));
    const message = verified.messages[id];
    expect(message.kind).toBe('voice');
    const mediaUrl = message.mediaUrl!;
    expect(mediaUrl).toBe(`${endpoint.replace(/\/$/, '')}/messages/${id}/content`);
    const response = await fetch(mediaUrl);
    expect(response.ok).toBe(true); expect(response.headers.get('content-type')).toMatch(/^audio\/ogg\b/);
    const received = Buffer.from(await response.arrayBuffer());
    expect(received.subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(received.includes(Buffer.from('OpusHead'))).toBe(true);
    expect(message.encodedBytes).toBe(received.length);

    // Backend voice encoding already requires FFmpeg. Require a genuine decode here as well.
    const decoded = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], { input: received, timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
    if (decoded.error) throw new Error(`Voice acceptance requires local FFmpeg: ${decoded.error.message}`);
    expect(decoded.status, decoded.stderr.toString()).toBe(0);
    // A 5.5 second input must be trimmed to five decoded seconds, allowing codec edge padding.
    const durationSeconds = decoded.stdout.length / 32_000;
    expect(durationSeconds).toBeGreaterThanOrEqual(4.95); expect(durationSeconds).toBeLessThanOrEqual(5.05);
    let peak = 0;
    for (let at = 0; at < decoded.stdout.length; at += 2) peak = Math.max(peak, Math.abs(decoded.stdout.readInt16LE(at)));
    expect(peak).toBeGreaterThan(1_000); // a decodable header alone must not pass

    const terminal = await waitFor(client, state => state.messages[id]?.receiptConfirmed === true || state.messages[id]?.status === 'receipt_unconfirmed' || state.messages[id]?.status === 'failed');
    expect(deliveryLabel(terminal.messages[id])).toBe('Delivered');
    const telemetry = deriveTelemetry(terminal, id);
    expect(telemetry.transmittedBytes).toBeGreaterThan(received.length);
    expect(terminal.events.some(event => event.messageId === id && event.kind === 'receipt_verified')).toBe(true);
    console.info('Verified voice transfer', { id, encodedBytes: received.length, radioBytes: telemetry.transmittedBytes, decodedSeconds: durationSeconds, peak, contentUrl: mediaUrl });
  } finally { client.dispose(); }
}, 210_000);
