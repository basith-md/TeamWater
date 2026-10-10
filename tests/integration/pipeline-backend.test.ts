// @vitest-environment node
import { expect, test } from 'vitest';
import { createMeshClient, deliveryLabel, deriveTelemetry } from '@teamwater/core';
import type { MeshClient, MeshState } from '@teamwater/core';

function until(client: MeshClient, predicate: (state: MeshState) => boolean) {
  return new Promise<MeshState>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`Pipeline state timed out: ${client.getSnapshot().error}`)); }, 35_000);
    const check = () => { const state = client.getSnapshot(); if (predicate(state)) { clearTimeout(timer); off(); resolve(state); } };
    const off = client.subscribe(check); check();
  });
}

test.runIf(Boolean(process.env.TEAMWATER_PIPELINE_URL))('the teammate pipeline supplies verified full text, real packet events and measured counters', async () => {
  const client = createMeshClient({ mode: 'live', endpoint: process.env.TEAMWATER_PIPELINE_URL });
  try {
    client.start();
    await until(client, state => state.nodes.length === 6);
    const text = 'Please fix the code. This complete message is longer than the sixty-character sender preview, and the receiver must obtain every character.';
    const id = await client.sendText('node0', 'node4', text);
    const state = await until(client, state => state.messages[id]?.text === text && state.messages[id]?.receiptConfirmed === true);
    expect(deliveryLabel(state.messages[id])).toBe('Delivered');
    expect(state.messages[id].integrity).toBe('verified');
    expect(state.events.some(event => event.messageId === id && event.kind === 'packet_tx')).toBe(true);
    expect(state.events.some(event => event.messageId === id && event.kind === 'receipt_verified')).toBe(true);
    const metrics = deriveTelemetry(state, id);
    expect(metrics.transmittedBytes).toBeGreaterThan(0);
    expect(metrics.bitRate).toBeGreaterThan(0);
    expect(metrics.rangeMeters).toBeNull();
    expect(metrics.latencyMs).toBeNull(); // backend clock measures channel occupancy, not end-to-end time
  } finally { client.dispose(); }
}, 45_000);
