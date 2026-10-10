// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

test('generated shared types preserve real distance-routing proof and Codec2 playback metadata', () => {
  const check = spawnSync(existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3', ['-c', `
import asyncio, yaml
from backend.mesh_backend import MeshBackend
from shared.python.models import MeshState, RoutingConfig, MediaMetadata
spec = yaml.safe_load(open('openapi.yaml'))
assert spec['paths']['/simulation/routing']['post']['requestBody']['content']['application/json']['schema']['$ref'].endswith('/RoutingConfig')
assert RoutingConfig(distance_routing=True).model_dump() == {'distance_routing': True}
async def run():
    backend = MeshBackend(distance_routing=True, playback_speed=5000, loss_rate=0)
    mid = await backend.send_message('node0', 'node4', b'route contract')
    await backend.wait_message(mid)
    wire = backend.get_state()
    parsed = MeshState.model_validate(wire).model_dump()
    assert parsed['simulation']['distance_routing'] is True
    assert parsed['simulation']['link_metrics'] == wire['simulation']['link_metrics']
    assert parsed['messages'][mid]['route_proof'] == wire['messages'][mid]['route_proof']
    assert parsed['messages'][mid]['route_proof']['optimal'] is True
    wire['messages'][mid]['eta'] = None
    wire['messages'][mid]['route_proof']['dijkstra_cost'] = None
    nullable = MeshState.model_validate(wire).model_dump()
    assert nullable['messages'][mid]['eta'] is None
    assert nullable['messages'][mid]['route_proof']['dijkstra_cost'] is None
    await backend.close()
asyncio.run(run())
metadata = MediaMetadata(codec='codec2', codec2_mode=1200, sample_rate=8000, sample_count=40000, mime='audio/codec2', playback_mime='audio/wav').model_dump()
assert metadata['codec2_mode'] == 1200 and metadata['sample_rate'] == 8000
assert metadata['sample_count'] == 40000 and metadata['playback_mime'] == 'audio/wav'
`], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, PYTHONNOUSERSITE: '1' } });
  expect(check.status, check.stderr || String(check.error)).toBe(0);
});

test.runIf(Boolean(process.env.TEAMWATER_PIPELINE_URL))('real Codec2 voice upload yields receiver-verified WAV playback, five seconds, and a terminal receipt', async () => {
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
    expect(response.ok).toBe(true); expect(response.headers.get('content-type')).toMatch(/^audio\/wav\b/);
    const received = Buffer.from(await response.arrayBuffer());
    expect(received.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(received.subarray(8, 12).toString('ascii')).toBe('WAVE');
    const snapshotResponse = await fetch(`${endpoint.replace(/\/$/, '')}/state`);
    expect(snapshotResponse.ok).toBe(true);
    const snapshot = await snapshotResponse.json();
    const wireMessage = snapshot.messages[id];
    expect(wireMessage.receiver_status).toBe('verified');
    expect(wireMessage.metadata).toMatchObject({ codec: 'codec2', codec2_mode: 1200, sample_rate: 8000, sample_count: 40000, mime: 'audio/codec2', playback_mime: 'audio/wav' });
    expect(message.encodedBytes).toBe(wireMessage.metadata.encoded_bytes);
    expect(message.encodedBytes).toBeGreaterThan(0);
    expect(message.encodedBytes).toBeLessThanOrEqual(800); // Five seconds at 1200 bits/s, including final frame padding.
    expect(received.length).toBeGreaterThan(message.encodedBytes! * 10); // WAV playback is reconstructed, not radio payload.

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
    expect(telemetry.transmittedBytes).toBeGreaterThan(message.encodedBytes!);
    expect(terminal.events.some(event => event.messageId === id && event.kind === 'receipt_verified')).toBe(true);
    console.info('Verified voice transfer', { id, encodedBytes: message.encodedBytes, playbackBytes: received.length, radioBytes: telemetry.transmittedBytes, decodedSeconds: durationSeconds, peak, contentUrl: mediaUrl });
  } finally { client.dispose(); }
}, 210_000);
